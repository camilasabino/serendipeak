import { expect, test } from '@playwright/test';
import { resetStub } from './support';

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

for (const path of ['/', '/mountains/aconcagua', '/preview', '/editorial/camera', '/missing']) {
	test(`${path} carries the security headers`, async ({ request }) => {
		const headers = (await request.get(path)).headers();

		expect(headers['x-content-type-options']).toBe('nosniff');
		expect(headers['x-frame-options']).toBe('DENY');
		expect(headers['permissions-policy']).toContain('fullscreen=(self)');
		expect(headers['content-security-policy']).toContain("frame-ancestors 'none'");
		expect(headers['content-security-policy-report-only']).toContain("script-src 'self'");
		expect(headers['strict-transport-security']).toBeUndefined();
	});
}

for (const path of ['/preview', '/editorial/camera']) {
	test(`${path} is not indexed or stored`, async ({ request }) => {
		const headers = (await request.get(path)).headers();

		expect(headers['x-robots-tag']).toBe('noindex, nofollow');
		expect(headers['cache-control']).toBe('no-store');
		expect(headers['referrer-policy']).toBe('no-referrer');
	});
}

for (const path of ['/', '/mountains/aconcagua']) {
	test(`${path} keeps the site-wide referrer policy`, async ({ request }) => {
		const headers = (await request.get(path)).headers();

		expect(headers['referrer-policy']).toBe('strict-origin-when-cross-origin');
	});
}

test('the preview exchange answers no-store and noindex', async ({ request }) => {
	const response = await request.get('/api/preview');
	const headers = response.headers();

	expect(response.status()).toBe(405);
	expect(headers['x-robots-tag']).toBe('noindex, nofollow');
	expect(headers['cache-control']).toBe('no-store');
});
