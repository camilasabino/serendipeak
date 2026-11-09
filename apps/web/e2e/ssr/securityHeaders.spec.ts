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
	});
}

const POLICIES: Array<[string, string]> = [
	['/preview', 'no-referrer'],
	['/editorial/camera', 'strict-origin']
];

for (const [path, policy] of POLICIES) {
	test(`${path} answers Referrer-Policy ${policy}`, async ({ request }) => {
		const headers = (await request.get(path)).headers();

		expect(headers['referrer-policy']).toBe(policy);
	});
}

test('the camera editor sends only its origin as Referer, never the draft query', async ({
	page,
	baseURL
}) => {
	const received: Array<string | undefined> = [];
	await page.route('https://referer-probe.test/**', async (route) => {
		received.push(route.request().headers()['referer']);
		await route.fulfill({
			status: 200,
			headers: { 'access-control-allow-origin': '*' },
			body: 'ok'
		});
	});

	await page.goto('/editorial/camera?name=Secret+Draft&lat=1.5&lon=2.5');
	await page.evaluate(
		(url) =>
			new Promise<void>((resolve) => {
				const probe = new Image();
				probe.onload = probe.onerror = () => resolve();
				probe.src = url;
			}),
		'https://referer-probe.test/ion.png'
	);

	expect(received).toEqual([`${new URL(baseURL as string).origin}/`]);
});

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
