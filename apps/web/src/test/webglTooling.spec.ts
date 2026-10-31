import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const { scripts } = JSON.parse(
	readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
) as { scripts: Record<string, string> };

describe('WebGL suite tooling', () => {
	it.each(['test:webgl', 'test:webgl:prod'])(
		'%s prepares the Cesium static assets before it starts a server',
		(name) => {
			const steps = scripts[name]!.split('&&').map((step) => step.trim());

			expect(steps[0]).toBe('npm run cesium:assets');
			expect(steps.at(-1)).toMatch(/playwright test/);
		}
	);

	it('has one asset copy command that the other scripts reuse', () => {
		const copiers = Object.values(scripts).filter((script) =>
			script.includes('copy-cesium-assets')
		);

		expect(copiers).toEqual([scripts['cesium:assets']]);
	});
});
