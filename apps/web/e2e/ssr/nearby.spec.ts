import { expect, test } from '@playwright/test';
import { resetStub, stubRequests, useScenario } from './support';

const NEARBY_HEADING = /<h2[^>]*>Nearby mountains<\/h2>/;

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('nearby mountains', () => {
	test('are server-rendered as links on a permalink, from the one index request', async ({
		request
	}) => {
		await useScenario(request, 'catalog');

		const html = await (await request.get('/mountains/aconcagua')).text();

		expect(html).toMatch(NEARBY_HEADING);
		expect(html).toContain('href="/mountains/cerro-el-plata"');
		expect(html).toContain('Cerro El Plata');
		expect(html).toContain('≈ 66 km');
		expect(html).not.toMatch(/href="\/mountains\/aconcagua"/);
		expect(await stubRequests(request)).toEqual([
			'/api/v1/mountains/aconcagua',
			'/api/v1/mountains'
		]);
	});

	test('are left out, heading included, where the catalog has nothing close', async ({
		request
	}) => {
		const response = await request.get('/mountains/aconcagua');
		const html = await response.text();

		expect(response.status()).toBe(200);
		expect(html).not.toMatch(NEARBY_HEADING);
		expect(html).not.toContain('Nearby mountains');
	});

	test('appear on the page of the day too', async ({ request }) => {
		await useScenario(request, 'catalog');

		const html = await (await request.get('/')).text();

		expect(html).toMatch(NEARBY_HEADING);
	});

	test('ask the index for nothing when the mountain is not found', async ({ request }) => {
		const response = await request.get('/mountains/nowhere');

		expect(response.status()).toBe(404);
		expect(await stubRequests(request)).toEqual(['/api/v1/mountains/nowhere']);
	});
});
