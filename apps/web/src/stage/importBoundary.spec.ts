import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const WEB_ROOT = new URL('../..', import.meta.url).pathname;
const SRC = join(WEB_ROOT, 'src');
const ADAPTER_DIRECTORY = join('stage', 'globe', 'cesium');
const TEST_FILE = /\.spec\.tsx?$/;
const IMPORT_SPECIFIER = /\b(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g;
const CESIUM_SPECIFIER = /^cesium(\/|$)/;

function sourceFiles(directory = ''): string[] {
	return readdirSync(join(SRC, directory), { withFileTypes: true }).flatMap((entry) => {
		const path = join(directory, entry.name);
		if (entry.isDirectory()) return sourceFiles(path);
		return /\.tsx?$/.test(entry.name) && !TEST_FILE.test(entry.name) ? [path] : [];
	});
}

function cesiumImports(file: string): string[] {
	const source = readFileSync(join(SRC, file), 'utf8');
	return [...source.matchAll(IMPORT_SPECIFIER)]
		.map((match) => match[1]!)
		.filter((specifier) => CESIUM_SPECIFIER.test(specifier));
}

// Specs are excluded here because some carry import fixtures as text; ESLint below covers them.
describe('cesium import boundary (sources)', () => {
	const files = sourceFiles();

	it('discovers the adapter and the rest of the application', () => {
		expect(files).toEqual(
			expect.arrayContaining([
				join(ADAPTER_DIRECTORY, 'CesiumGlobeScene.ts'),
				join('stage', 'SceneSession.ts'),
				join('api', 'HttpMountainApi.ts')
			])
		);
	});

	it('is imported by the adapter and by nothing else', () => {
		const importers = files.filter((file) => cesiumImports(file).length > 0);

		expect(importers.length).toBeGreaterThan(0);
		expect(importers.filter((file) => !file.startsWith(ADAPTER_DIRECTORY))).toEqual([]);
	});

	it('is dynamically imported only by CesiumGlobeScene', () => {
		const dynamic = files.filter((file) => {
			const source = readFileSync(join(SRC, file), 'utf8');
			return /(?<!typeof\s+)\bimport\s*\(\s*['"]cesium['"]\s*\)/.test(source);
		});

		expect(dynamic).toEqual([join(ADAPTER_DIRECTORY, 'CesiumGlobeScene.ts')]);
	});
});

describe('cesium import boundary (ESLint)', () => {
	const eslint = new ESLint({ cwd: WEB_ROOT });

	async function restrictions(filePath: string, code: string): Promise<string[]> {
		const [result] = await eslint.lintText(code, { filePath: join(WEB_ROOT, filePath) });
		return result!.messages
			.filter((message) => /restricted/.test(message.ruleId ?? ''))
			.map((message) => message.message);
	}

	const OUTSIDE = [
		['a static import', "import { Viewer } from 'cesium';\nexport const x = Viewer;\n"],
		['a type import', "import type { Viewer } from 'cesium';\nexport type X = Viewer;\n"],
		['a subpath import', "import 'cesium/Build/Cesium/Widgets/widgets.css';\n"],
		['a re-export', "export * from 'cesium';\n"],
		['a dynamic import', "export const load = () => import('cesium');\n"]
	] as const;

	it.each(OUTSIDE)(
		'rejects %s in an ordinary application module',
		async (_name, code) => {
			expect(await restrictions('src/mountain-page/example.ts', code)).toEqual([
				expect.stringContaining('GlobeScene')
			]);
		},
		30_000
	);

	it.each(['src/stage/frameworkFree.spec.ts', 'src/stage/globe/choreography.ts'])(
		'rejects cesium in %s',
		async (filePath) => {
			expect(await restrictions(filePath, "import { Cartesian3 } from 'cesium';\n")).toHaveLength(
				1
			);
		}
	);

	it('rejects cesium in the API gateway', async () => {
		expect(await restrictions('src/api/HttpMountainApi.ts', "import 'cesium';\n")).toHaveLength(1);
	});

	it('allows cesium inside the adapter directory', async () => {
		const code =
			"import type { Viewer } from 'cesium';\nexport const load = () => import('cesium');\n";

		expect(await restrictions('src/stage/globe/cesium/example.ts', code)).toEqual([]);
		expect(await restrictions('src/stage/globe/cesium/example.spec.ts', code)).toEqual([]);
	});

	it('keeps the fetch boundary in force, including inside the adapter', async () => {
		const code = "export const get = () => fetch('/x');\n";

		expect(await restrictions('src/stage/example.ts', code)).toHaveLength(1);
		expect(await restrictions('src/stage/globe/cesium/example.ts', code)).toHaveLength(1);
		expect(await restrictions('src/api/HttpMountainApi.ts', code)).toEqual([]);
	});
});
