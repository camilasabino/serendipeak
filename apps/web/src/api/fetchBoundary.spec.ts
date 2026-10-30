import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint({ cwd: new URL('../../', import.meta.url).pathname });

async function violations(filePath: string, source: string): Promise<string[]> {
	const [result] = await eslint.lintText(source, { filePath });
	return (result?.messages ?? [])
		.filter(
			(message) =>
				message.ruleId === 'no-restricted-globals' || message.ruleId === 'no-restricted-syntax'
		)
		.map((message) => message.message);
}

const CALLERS = [
	'await fetch(url);',
	'await globalThis.fetch(url);',
	'await window.fetch(url);',
	"await globalThis['fetch'](url);",
	'const { fetch } = globalThis; await fetch(url);',
	'const send = fetch; await send(url);'
];

describe('direct fetch boundary', () => {
	it.each(CALLERS)('forbids %s in application code', async (source) => {
		expect(await violations('src/mountain-page/loadDailyPage.ts', source)).not.toHaveLength(0);
	});

	it.each(['src/pages/index.tsx', 'src/api/serverMountainApi.ts', 'src/api/MountainApi.ts'])(
		'forbids fetch in %s',
		async (filePath) => {
			expect(await violations(filePath, 'await fetch(url);')).not.toHaveLength(0);
		}
	);

	it('allows fetch inside HttpMountainApi', async () => {
		const source = 'const send = (input: string) => globalThis.fetch(input); await fetch(url);';

		expect(await violations('src/api/HttpMountainApi.ts', source)).toEqual([]);
	});

	it('allows tests and fakes to inject a fetch stub without calling the global', async () => {
		const source = [
			"import { vi } from 'vitest';",
			'const stub = vi.fn<typeof globalThis.fetch>();',
			'new HttpMountainApi({ baseUrl, fetch: stub });'
		].join('\n');

		expect(await violations('src/api/HttpMountainApi.spec.ts', source)).toEqual([]);
	});
});
