import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = new URL('..', import.meta.url).pathname;
const OUTSIDE_BOUNDARY = ['stage/globe/cesium'];
const TEST_FILE = /\.(spec|test)\.tsx?$/;
const IMPORT_SPECIFIER = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const FORBIDDEN_PACKAGE = /^(cesium|react|react-dom|next)(\/|$)/;
const PAGE_CODE = /^(?:\.\.?\/)+(mountain-page|shell|pages)(\/|$)/;

function sources(directory: string): string[] {
	return readdirSync(join(SRC, directory), { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (OUTSIDE_BOUNDARY.includes(path)) return [];
		if (entry.isDirectory()) return sources(path);
		return /\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
	});
}

function importSpecifiers(source: string): string[] {
	return [...source.matchAll(IMPORT_SPECIFIER)].map((match) => match[1]!);
}

const REACT_BINDINGS = [
	'stage/useStage.ts',
	'stage/useStageFullscreen.ts',
	'stage/MountainScene.tsx',
	...sources('stage/controls')
];
const FORBIDDEN_FOR_BINDINGS = /^(cesium|react-dom|next)(\/|$)/;

const FRAMEWORK_FREE_FILES = [...sources('stage'), ...sources('media')].filter(
	(file) => !REACT_BINDINGS.includes(file)
);

describe('framework-free scene and media modules', () => {
	it('discovers the ported modules', () => {
		expect(FRAMEWORK_FREE_FILES).toEqual(
			expect.arrayContaining([
				'stage/sceneState.ts',
				'stage/globe/choreography.ts',
				'media/preload.ts'
			])
		);
		expect(REACT_BINDINGS).toContain('stage/controls/StageControls.tsx');
	});

	it('detects normal, side-effect and dynamic imports', () => {
		const source = [
			"import { X } from 'cesium';",
			"import 'react';",
			"import('next/router');",
			"export * from '../shell/x';"
		].join('\n');

		expect(importSpecifiers(source)).toEqual(['cesium', 'react', 'next/router', '../shell/x']);
	});

	it.each(FRAMEWORK_FREE_FILES)('%s imports no engine, UI framework or page code', (file) => {
		const specifiers = importSpecifiers(readFileSync(join(SRC, file), 'utf8'));

		expect(specifiers.filter((s) => FORBIDDEN_PACKAGE.test(s) || PAGE_CODE.test(s))).toEqual([]);
	});
});

describe('React bindings of the stage', () => {
	it.each(REACT_BINDINGS)('%s imports no engine, Next or page code', (file) => {
		const specifiers = importSpecifiers(readFileSync(join(SRC, file), 'utf8'));

		expect(specifiers.filter((s) => FORBIDDEN_FOR_BINDINGS.test(s) || PAGE_CODE.test(s))).toEqual(
			[]
		);
	});
});
