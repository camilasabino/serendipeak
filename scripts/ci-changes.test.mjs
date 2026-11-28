import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { diffRange, gateProblems, route } from './ci-changes.mjs';

const ALL = { api: true, web: true, contracts: true, scripts: true };
const NONE = { api: false, web: false, contracts: false, scripts: false };

describe('route', () => {
	test('documentation-only commit runs no application job', () => {
		assert.deepEqual(
			route([
				'README.md',
				'docs/media/README.md',
				'docs/media/atlas.webp',
				'docs/media/mountain-view.webp',
			]),
			NONE,
		);
	});

	test('frontend-only change runs Web only', () => {
		assert.deepEqual(route(['apps/web/src/stage/Stage.tsx', 'apps/web/package.json']), {
			...NONE,
			web: true,
		});
	});

	test('backend-only change runs API only', () => {
		assert.deepEqual(route(['services/api/serendipeak/catalog/slug.py', 'services/api/uv.lock']), {
			...NONE,
			api: true,
		});
	});

	test('backup services run Scripts only', () => {
		assert.deepEqual(route(['services/backup/backup.sh', 'services/offsite-backup/Dockerfile']), {
			...NONE,
			scripts: true,
		});
	});

	test('contract changes run every consumer of the fixtures', () => {
		assert.deepEqual(route(['contracts/v1/catalog.json']), {
			api: true,
			web: true,
			contracts: true,
			scripts: false,
		});
	});

	test('scripts changes run Scripts and Contracts', () => {
		assert.deepEqual(route(['scripts/contracts-lib.mjs']), {
			...NONE,
			contracts: true,
			scripts: true,
		});
	});

	test('mixed documentation and frontend commit runs Web only', () => {
		assert.deepEqual(route(['README.md', 'apps/web/src/index.ts']), { ...NONE, web: true });
	});

	test('mixed frontend and backend commit runs both', () => {
		assert.deepEqual(route(['apps/web/src/index.ts', 'services/api/manage.py']), {
			...NONE,
			web: true,
			api: true,
		});
	});

	for (const path of [
		'.github/workflows/ci.yml',
		'package.json',
		'package-lock.json',
		'.nvmrc',
		'.python-version',
		'commitlint.config.mjs',
		'docker-compose.yml',
		'.husky/commit-msg',
		'.env.example',
		'.gitignore',
		'CLAUDE.md',
		'new-top-level/file.txt',
	]) {
		test(`unclassified or shared path runs everything: ${path}`, () => {
			assert.deepEqual(route(['README.md', path]), ALL);
		});
	}

	test('a path that only resembles a documentation prefix is not documentation', () => {
		assert.deepEqual(route(['docs-tooling/run.sh']), ALL);
		assert.deepEqual(route(['README.md.bak']), ALL);
	});

	test('an empty diff cannot be classified and runs everything', () => {
		assert.deepEqual(route([]), ALL);
	});
});

describe('diffRange', () => {
	test('pull requests diff against the merge base', () => {
		assert.equal(
			diffRange({ eventName: 'pull_request', baseSha: 'aaa', headSha: 'bbb' }),
			'aaa...bbb',
		);
	});

	test('pushes diff the whole pushed range', () => {
		assert.equal(diffRange({ eventName: 'push', beforeSha: 'aaa', sha: 'bbb' }), 'aaa..bbb');
	});

	test('a new branch or missing before sha has no usable range', () => {
		assert.equal(
			diffRange({ eventName: 'push', beforeSha: '0'.repeat(40), sha: 'bbb' }),
			null,
		);
		assert.equal(diffRange({ eventName: 'push', sha: 'bbb' }), null);
	});

	test('unknown events have no usable range', () => {
		assert.equal(diffRange({ eventName: 'workflow_dispatch' }), null);
	});
});

describe('gateProblems', () => {
	const needs = (routed, results = {}) => ({
		changes: { result: 'success', outputs: routed },
		commitlint: { result: 'success' },
		contracts: { result: 'skipped' },
		api: { result: 'skipped' },
		web: { result: 'skipped' },
		scripts: { result: 'skipped' },
		...results,
	});

	test('passes a documentation-only run where everything else is skipped', () => {
		assert.deepEqual(gateProblems(needs({})), []);
	});

	test('passes when routed jobs succeed', () => {
		assert.deepEqual(
			gateProblems(needs({ web: 'true' }, { web: { result: 'success' } })),
			[],
		);
	});

	test('fails a routed job that failed, was cancelled or was skipped', () => {
		for (const result of ['failure', 'cancelled', 'skipped']) {
			assert.equal(
				gateProblems(needs({ web: 'true' }, { web: { result } })).length,
				1,
				result,
			);
		}
	});

	test('fails an unrouted job that ran', () => {
		assert.equal(gateProblems(needs({}, { api: { result: 'success' } })).length, 1);
	});

	test('fails when commit message validation did not succeed', () => {
		for (const result of ['failure', 'cancelled', 'skipped']) {
			assert.equal(gateProblems(needs({}, { commitlint: { result } })).length, 1, result);
		}
	});

	test('fails when routing itself did not succeed', () => {
		assert.equal(gateProblems({ ...needs({}), changes: { result: 'failure' } }).length, 1);
		assert.equal(gateProblems({}).length, 1);
	});
});

describe('workflow wiring', () => {
	const workflow = readFileSync(
		fileURLToPath(new URL('../.github/workflows/ci.yml', import.meta.url)),
		'utf8',
	);

	test('does not filter the workflow by paths, which would leave required checks pending', () => {
		assert.doesNotMatch(workflow, /^\s+paths(-ignore)?:/m);
	});

	for (const job of ['contracts', 'api', 'web', 'scripts']) {
		test(`${job} is gated on its routing output`, () => {
			const block = workflow.split(new RegExp(`^  ${job}:$`, 'm'))[1]?.split(/^  \w[\w-]*:$/m)[0];
			assert.ok(block, `job ${job} not found`);
			assert.match(block, new RegExp(`needs\\.changes\\.outputs\\.${job} == 'true'`));
		});
	}

	test('fetches full history so push and pull request ranges resolve', () => {
		const changes = workflow.split(/^  changes:$/m)[1].split(/^  \w[\w-]*:$/m)[0];
		assert.match(changes, /fetch-depth: 0/);
	});

	test('the gate consumes every other job', () => {
		assert.match(workflow, /needs: \[changes, commitlint, contracts, api, web, scripts\]/);
	});
});
