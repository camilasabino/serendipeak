import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const GATE = new URL('../../scripts/production-gate.mjs', import.meta.url).pathname;

const created: string[] = [];

afterEach(() => {
	for (const directory of created.splice(0)) {
		rmSync(directory, { recursive: true, force: true });
	}
});

function buildWith(files: Record<string, string>): string {
	const root = mkdtempSync(join(tmpdir(), 'gate-'));
	created.push(root);
	for (const subdirectory of ['static', 'server']) {
		mkdirSync(join(root, subdirectory), { recursive: true });
	}
	for (const [path, content] of Object.entries(files)) {
		writeFileSync(join(root, path), content);
	}

	return root;
}

function runGate(...args: string[]) {
	return spawnSync(process.execPath, [GATE, ...args], { encoding: 'utf8' });
}

describe('production gate', () => {
	it('passes a build without diagnostic identifiers', () => {
		const result = runGate(buildWith({ 'static/app.js': 'console.log("hello")' }));

		expect(result.status).toBe(0);
	});

	it.each([
		['the camera diagnostic global', 'window.__serendipeakCamera = read'],
		['a v1 development tool', 'providerLab()']
	])('fails a build that contains %s', (_name, content) => {
		const result = runGate(buildWith({ 'static/chunk.js': content }));

		expect(result.status).toBe(1);
		expect(result.stderr).toContain('forbidden identifiers');
	});

	it('also scans the server output', () => {
		const result = runGate(buildWith({ 'server/page.js': 'x.__serendipeakCamera' }));

		expect(result.status).toBe(1);
	});

	it('fails when the build output is missing', () => {
		expect(runGate(join(tmpdir(), 'gate-missing-output')).status).toBe(1);
	});

	it('rejects bad usage', () => {
		expect(runGate().status).toBe(2);
	});
});
