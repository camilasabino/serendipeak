import { describe, expect, it } from 'vitest';
import type { MountainIndexResult } from '../api/contract';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { indexEntry } from '../api/test-support/indexEntries';
import { robotsResponse, sitemapResponse } from './crawlResponses';

const ENV = { SITE_ORIGIN: 'https://serendipeak.example' };

function indexOf(...slugs: string[]): MountainIndexResult {
	return { kind: 'found', mountains: slugs.map((slug) => indexEntry(slug, slug)) };
}

function locs(body: string): string[] {
	return [...body.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]!);
}

describe('sitemapResponse', () => {
	it('serves the active catalog as XML that shared caches keep for five minutes', async () => {
		const response = await sitemapResponse(
			new FakeMountainApi({ index: indexOf('k2', 'aconcagua') }),
			ENV
		);

		expect(response.status).toBe(200);
		expect(response.headers['Content-Type']).toBe('application/xml; charset=utf-8');
		expect(response.headers['Cache-Control']).toBe('public, max-age=0, s-maxage=300');
		expect(locs(response.body).slice(3)).toEqual([
			'https://serendipeak.example/mountains/aconcagua',
			'https://serendipeak.example/mountains/k2'
		]);
	});

	it('requests the index fresh, bypassing the cache the browser index uses', async () => {
		const api = new FakeMountainApi({ index: indexOf('a') });

		await sitemapResponse(api, ENV);

		expect(api.getMountainIndexOptions).toEqual([{ fresh: true }]);
	});

	it('follows the catalog: a published, deactivated or renamed mountain changes the next answer', async () => {
		const sitemapOf = async (index: MountainIndexResult) =>
			locs((await sitemapResponse(new FakeMountainApi({ index }), ENV)).body).slice(3);

		expect(await sitemapOf(indexOf('old-name'))).toEqual([`${ENV.SITE_ORIGIN}/mountains/old-name`]);
		expect(await sitemapOf(indexOf('old-name', 'new-peak'))).toContain(
			`${ENV.SITE_ORIGIN}/mountains/new-peak`
		);
		expect(await sitemapOf(indexOf('new-peak'))).toEqual([`${ENV.SITE_ORIGIN}/mountains/new-peak`]);
		expect(await sitemapOf(indexOf())).toEqual([]);
	});

	it('serves the static pages alone when the catalog is genuinely empty', async () => {
		const response = await sitemapResponse(new FakeMountainApi({ index: indexOf() }), ENV);

		expect(response.status).toBe(200);
		expect(locs(response.body)).toHaveLength(3);
	});

	it.each([
		['missing', {}],
		['blank', { SITE_ORIGIN: '  ' }],
		['not a URL', { SITE_ORIGIN: 'serendipeak' }],
		['carrying a path', { SITE_ORIGIN: 'https://serendipeak.example/app' }],
		['not http', { SITE_ORIGIN: 'ftp://serendipeak.example' }]
	])('fails with an uncacheable 500 and no API call when SITE_ORIGIN is %s', async (_name, env) => {
		const api = new FakeMountainApi({ index: indexOf('a') });

		const response = await sitemapResponse(api, env);

		expect(response.status).toBe(500);
		expect(response.headers['Cache-Control']).toBe('no-store');
		expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
		expect(api.getMountainIndexCalls).toBe(0);
	});

	it.each<[string, MountainIndexResult]>([
		['unreachable', { kind: 'unreachable' }],
		['an API error', { kind: 'api-error', status: 500 }],
		['an invalid body', { kind: 'api-error', status: 200 }]
	])('answers 503 with no-store, not a partial sitemap, on %s', async (_name, index) => {
		const response = await sitemapResponse(new FakeMountainApi({ index }), ENV);

		expect(response.status).toBe(503);
		expect(response.headers['Cache-Control']).toBe('no-store');
		expect(response.headers['Retry-After']).toBe('300');
		expect(response.body).not.toMatch(/<urlset|http|api/i);
	});
});

describe('robotsResponse', () => {
	it('serves text/plain with the sitemap directive for a valid origin', () => {
		const response = robotsResponse(ENV);

		expect(response.status).toBe(200);
		expect(response.headers['Content-Type']).toBe('text/plain; charset=utf-8');
		expect(response.body).toContain('Sitemap: https://serendipeak.example/sitemap.xml');
	});

	it.each([{}, { SITE_ORIGIN: 'not a url' }])(
		'still serves the crawl rules, without a sitemap line, for %o',
		(env) => {
			const response = robotsResponse(env);

			expect(response.status).toBe(200);
			expect(response.body).toContain('Disallow: /preview');
			expect(response.body).not.toContain('Sitemap');
		}
	);
});
