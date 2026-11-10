import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { requiresWebgl } from './classify-changes.mjs';

const script = fileURLToPath(new URL('./classify-changes.mjs', import.meta.url));
const required = (paths) => requiresWebgl(paths).required;

test('documentation-only changes skip the browser suites', () => {
	assert.equal(required(['README.md']), false);
	assert.equal(required(['README.md', 'CLAUDE.md', 'docs/deployment.md']), false);
	assert.equal(required(['docs/brand/social-preview.png', 'docs/media/mountain-view.webp']), false);
});

test('application, dependency, build and workflow changes run the suites', () => {
	for (const path of [
		'apps/web/src/stage/globe/scene.ts',
		'apps/web/package-lock.json',
		'apps/web/next.config.ts',
		'apps/web/playwright.webgl.config.ts',
		'apps/web/e2e/webgl/stage.spec.ts',
		'apps/web/public/favicon.ico',
		'services/api/serendipeak/catalog/slug.py',
		'contracts/v1/mountain.json',
		'.github/workflows/ci.yml',
		'scripts/classify-changes.mjs',
		'package.json',
		'.nvmrc'
	]) {
		assert.equal(required([path]), true, path);
	}
});

test('one relevant path among documentation runs the suites', () => {
	assert.equal(required(['README.md', 'docs/deployment.md', 'apps/web/src/pages/index.tsx']), true);
});

test('markdown outside the repository root or docs is not assumed inert', () => {
	assert.equal(required(['apps/web/AGENTS.md']), true);
	assert.equal(required(['apps/web/src/content/notes.md']), true);
	assert.equal(required(['docs-extra/guide.md']), true);
});

test('lookalike paths are not documentation', () => {
	assert.equal(required(['README.md.js']), true);
	assert.equal(required(['readme.mdx']), true);
	assert.equal(required(['mydocs/page.md']), true);
});

test('an empty change set runs the suites', () => {
	assert.equal(required([]), true);
});

function repository(commits) {
	const directory = mkdtempSync(join(tmpdir(), 'classify-'));
	const git = (...args) => execFileSync('git', args, { cwd: directory, encoding: 'utf8' }).trim();
	const shas = [];

	git('init', '-q', '-b', 'main');
	git('config', 'user.email', 'ci@example.com');
	git('config', 'user.name', 'CI');

	for (const files of commits) {
		for (const [path, content] of Object.entries(files)) {
			mkdirSync(dirname(join(directory, path)), { recursive: true });
			writeFileSync(join(directory, path), content);
		}

		git('add', '-A');
		git('commit', '-q', '-m', 'change');
		shas.push(git('rev-parse', 'HEAD'));
	}

	return { directory, shas };
}

function classifyIn(directory, ...args) {
	const result = spawnSync(process.execPath, [script, ...args], {
		cwd: directory,
		encoding: 'utf8'
	});

	return result.stdout.trim();
}

test('a push of documentation-only commits skips the suites', () => {
	const { directory, shas } = repository([
		{ 'apps/web/a.ts': 'a' },
		{ 'README.md': 'one' },
		{ 'docs/guide.md': 'two' }
	]);

	assert.equal(classifyIn(directory, 'push', shas[0], shas[2]), 'webgl=false');
});

test('a multi-commit push with one code commit in the middle runs the suites', () => {
	const { directory, shas } = repository([
		{ 'apps/web/a.ts': 'a' },
		{ 'README.md': 'one' },
		{ 'apps/web/b.ts': 'b' },
		{ 'docs/guide.md': 'two' }
	]);

	assert.equal(classifyIn(directory, 'push', shas[0], shas[3]), 'webgl=true');
});

test('a code change that a later commit reverts leaves only documentation', () => {
	const { directory, shas } = repository([
		{ 'apps/web/a.ts': 'a' },
		{ 'apps/web/a.ts': 'changed', 'README.md': 'one' },
		{ 'apps/web/a.ts': 'a' }
	]);

	assert.equal(classifyIn(directory, 'push', shas[0], shas[2]), 'webgl=false');
});

test('a new branch, an unknown or malformed base and a missing head run the suites', () => {
	const { directory, shas } = repository([{ 'README.md': 'one' }, { 'README.md': 'two' }]);
	const zeros = '0'.repeat(40);
	const unknown = 'a'.repeat(40);

	assert.equal(classifyIn(directory, 'push', zeros, shas[1]), 'webgl=true');
	assert.equal(classifyIn(directory, 'push', unknown, shas[1]), 'webgl=true');
	assert.equal(classifyIn(directory, 'push', 'main~1', shas[1]), 'webgl=true');
	assert.equal(classifyIn(directory, 'push', '', shas[1]), 'webgl=true');
	assert.equal(classifyIn(directory, 'push', shas[0]), 'webgl=true');
});

test('pull requests compare against the merge base', () => {
	const { directory, shas } = repository([{ 'README.md': 'one' }, { 'README.md': 'two' }]);

	assert.equal(classifyIn(directory, 'pull_request', shas[0], shas[1]), 'webgl=false');
});

test('an unsupported event runs the suites', () => {
	const { directory, shas } = repository([{ 'README.md': 'one' }, { 'README.md': 'two' }]);

	assert.equal(classifyIn(directory, 'schedule', shas[0], shas[1]), 'webgl=true');
	assert.equal(classifyIn(directory), 'webgl=true');
});
