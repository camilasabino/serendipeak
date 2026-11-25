import { describe, expect, it } from 'vitest';
import { buildRobotsTxt } from './robots';

function directives(text: string, name: string): string[] {
	return text
		.split('\n')
		.filter((line) => line.startsWith(`${name}:`))
		.map((line) => line.slice(name.length + 1).trim());
}

describe('buildRobotsTxt', () => {
	it('is plain text with one group for every crawler, ending in a newline', () => {
		const text = buildRobotsTxt('https://serendipeak.example');

		expect(text.startsWith('User-agent: *\n')).toBe(true);
		expect(text.endsWith('\n')).toBe(true);
		expect(text).not.toMatch(/<|>/);
	});

	it('advertises the absolute sitemap of the configured origin', () => {
		expect(directives(buildRobotsTxt('https://serendipeak.example'), 'Sitemap')).toEqual([
			'https://serendipeak.example/sitemap.xml'
		]);
	});

	it('advertises no sitemap without a valid origin but keeps the crawl rules', () => {
		const text = buildRobotsTxt(undefined);

		expect(text).not.toContain('Sitemap');
		expect(directives(text, 'Disallow')).toEqual(['/api/', '/editorial/', '/preview']);
	});

	it('keeps the editorial, preview and API paths away from crawlers', () => {
		expect(directives(buildRobotsTxt(undefined), 'Disallow')).toEqual(
			expect.arrayContaining(['/api/', '/editorial/', '/preview'])
		);
	});

	it('does not block the public pages or the assets that render them', () => {
		const disallowed = directives(buildRobotsTxt(undefined), 'Disallow');
		const publicPaths = ['/', '/atlas', '/about', '/mountains/aconcagua', '/_next/static/a.js'];
		const assets = [
			'/brand/serendipeak-mark.png',
			'/brand/serendipeak-mountain-social-v2.png',
			'/cesium/Widgets/widgets.css'
		];

		for (const path of [...publicPaths, ...assets]) {
			expect(disallowed.some((rule) => path.startsWith(rule))).toBe(false);
		}
	});
});
