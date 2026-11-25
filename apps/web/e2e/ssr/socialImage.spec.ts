import { expect, test } from '@playwright/test';
import { SITE_ORIGIN } from '../support/ports';
import { resetStub } from './support';

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

function meta(html: string, attribute: 'name' | 'property', key: string): string | undefined {
	return new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`).exec(html)?.[1];
}

test.describe('social image', () => {
	const card = `${SITE_ORIGIN}/brand/serendipeak-mountain-social-v2.png`;

	test('gives a mountain page the illustrated card as an absolute, wide image', async ({
		request
	}) => {
		const html = await (await request.get('/mountains/aconcagua')).text();

		expect(meta(html, 'property', 'og:image')).toBe(card);
		expect(meta(html, 'name', 'twitter:image')).toBe(card);
		expect(meta(html, 'name', 'twitter:card')).toBe('summary_large_image');
		expect(meta(html, 'property', 'og:image:width')).toBe('1200');
		expect(meta(html, 'property', 'og:image:height')).toBe('630');
		expect(html).toContain(`<link rel="canonical" href="${SITE_ORIGIN}/mountains/aconcagua"`);
	});

	test('keeps the square brand mark on the homepage', async ({ request }) => {
		const html = await (await request.get('/')).text();

		expect(meta(html, 'property', 'og:image')).toBe(`${SITE_ORIGIN}/brand/serendipeak-mark.png`);
		expect(meta(html, 'name', 'twitter:card')).toBe('summary');
	});

	test('serves the card as a PNG', async ({ request }) => {
		const response = await request.get('/brand/serendipeak-mountain-social-v2.png');
		const body = await response.body();

		expect(response.status()).toBe(200);
		expect(response.headers()['content-type']).toBe('image/png');
		expect(body.readUInt32BE(16)).toBe(1200);
		expect(body.readUInt32BE(20)).toBe(630);
		expect(body.length).toBeLessThanOrEqual(300_000);
	});
});
