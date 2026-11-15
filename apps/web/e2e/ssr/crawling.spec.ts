import { expect, test } from '@playwright/test';
import { SITE_ORIGIN } from '../support/ports';
import { resetStub, stubRequests, useScenario } from './support';

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

function locs(xml: string): string[] {
	return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((match) => match[1]!);
}

test.describe('sitemap.xml', () => {
	test('lists the static pages and every active mountain on the configured origin', async ({
		request
	}) => {
		const response = await request.get('/sitemap.xml');
		const xml = await response.text();
		const urls = locs(xml);

		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('application/xml; charset=utf-8');
		expect(response.headers()['cache-control']).toBe('public, max-age=0, s-maxage=300');
		expect(xml).toContain('xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"');
		expect(urls.slice(0, 3)).toEqual([
			`${SITE_ORIGIN}/`,
			`${SITE_ORIGIN}/atlas`,
			`${SITE_ORIGIN}/about`
		]);
		expect(urls).toContain(`${SITE_ORIGIN}/mountains/aconcagua`);
		expect(new Set(urls).size).toBe(urls.length);
		expect(urls.every((url) => url.startsWith(`${SITE_ORIGIN}/`))).toBe(true);
		expect(urls.some((url) => /preview|editorial|\/api\//.test(url))).toBe(false);
	});

	test('reads the index once per request without reusing an earlier answer', async ({
		request
	}) => {
		await request.get('/sitemap.xml');
		await request.get('/sitemap.xml');

		expect(await stubRequests(request)).toEqual(['/api/v1/mountains', '/api/v1/mountains']);
	});

	for (const scenario of ['unreachable', 'malformed', 'server-error']) {
		test(`answers an uncacheable 503 when the API is ${scenario}`, async ({ request }) => {
			await useScenario(request, scenario);

			const response = await request.get('/sitemap.xml');
			const body = await response.text();

			expect(response.status()).toBe(503);
			expect(response.headers()['cache-control']).toBe('no-store');
			expect(body).not.toContain('<urlset');
			expect(body).not.toMatch(/127\.0\.0\.1|internal/i);
		});
	}
});

test.describe('robots.txt', () => {
	test('serves plain-text crawl rules and the absolute sitemap', async ({ request }) => {
		const response = await request.get('/robots.txt');
		const text = await response.text();

		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('text/plain; charset=utf-8');
		expect(text).toContain('User-agent: *');
		expect(text).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`);
		expect(text).toMatch(/^Disallow: \/api\/$/m);
		expect(text).toMatch(/^Disallow: \/editorial\/$/m);
		expect(text).toMatch(/^Disallow: \/preview$/m);
		expect(text).not.toMatch(/^Disallow: \/(_next|mountains|atlas|about)?$/m);
	});

	test('calls no API', async ({ request }) => {
		await request.get('/robots.txt');

		expect(await stubRequests(request)).toEqual([]);
	});
});
