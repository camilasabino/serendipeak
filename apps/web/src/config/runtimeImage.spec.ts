import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const webRoot = join(__dirname, '..', '..');

describe('production image', () => {
	it('ships every local module that next.config.ts imports', () => {
		const config = readFileSync(join(webRoot, 'next.config.ts'), 'utf8');
		const dockerfile = readFileSync(join(webRoot, 'Dockerfile'), 'utf8');
		const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));

		const localImports = [...config.matchAll(/from\s+'(\.[^']+)'/g)].map(
			(match) => match[1] as string
		);
		expect(localImports.length).toBeGreaterThan(0);

		for (const specifier of localImports) {
			const source = `${specifier.replace(/^\.\//, '')}.ts`;
			expect(runtime, `${source} must be copied into the runtime stage`).toContain(
				`/app/${source} ./${source}`
			);
		}
	});
});
