import { describe, expect, it } from 'vitest';
import { buildSitemapXml, escapeXml, sitemapPaths } from './sitemap';

const ORIGIN = 'https://serendipeak.example';

function locs(xml: string): string[] {
	return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]!);
}

describe('sitemapPaths', () => {
	it('lists the static pages before the mountains, sorted by slug', () => {
		expect(sitemapPaths(['k2', 'aconcagua', 'denali'])).toEqual([
			'/',
			'/atlas',
			'/about',
			'/mountains/aconcagua',
			'/mountains/denali',
			'/mountains/k2'
		]);
	});

	it('is independent of the order the index arrives in', () => {
		expect(sitemapPaths(['b', 'a', 'c'])).toEqual(sitemapPaths(['c', 'b', 'a']));
	});

	it('collapses repeated slugs', () => {
		expect(sitemapPaths(['a', 'a', 'b']).filter((path) => path === '/mountains/a')).toHaveLength(1);
	});

	it('lists only the static pages for an empty catalog', () => {
		expect(sitemapPaths([])).toEqual(['/', '/atlas', '/about']);
	});

	it('encodes a slug the way the mountain links do', () => {
		expect(sitemapPaths(['a b'])).toContain('/mountains/a%20b');
	});
});

describe('buildSitemapXml', () => {
	it('is a urlset in the sitemap namespace with an XML declaration', () => {
		const xml = buildSitemapXml(ORIGIN, ['aconcagua']);

		expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>\n')).toBe(true);
		expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
		expect(xml.trimEnd().endsWith('</urlset>')).toBe(true);
	});

	it('makes every location absolute on the given origin', () => {
		expect(locs(buildSitemapXml(ORIGIN, ['aconcagua']))).toEqual([
			`${ORIGIN}/`,
			`${ORIGIN}/atlas`,
			`${ORIGIN}/about`,
			`${ORIGIN}/mountains/aconcagua`
		]);
	});

	it('omits lastmod, changefreq and priority', () => {
		expect(buildSitemapXml(ORIGIN, ['aconcagua'])).not.toMatch(/lastmod|changefreq|priority/);
	});

	it('escapes every location, whatever the origin and slugs contain', () => {
		const xml = buildSitemapXml('https://a.example/?a=1&b=<2>', ['x&y']);

		expect(xml).toContain('<loc>https://a.example/?a=1&amp;b=&lt;2&gt;/atlas</loc>');
		expect(xml).toContain('/mountains/x%26y</loc>');
		expect(xml).not.toMatch(/<loc>[^<]*&(?!amp;|lt;|gt;|quot;|apos;)/);
	});
});

describe('escapeXml', () => {
	it('escapes ampersand first so entities are not escaped twice', () => {
		expect(escapeXml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&apos;');
	});
});
