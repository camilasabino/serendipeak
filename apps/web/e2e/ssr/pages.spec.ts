import { expect, test } from '@playwright/test';
import {
	fixture,
	hasTryAgain,
	headingsOf,
	resetStub,
	stubRequests,
	titleOf,
	useScenario
} from './support';

interface Mountain {
	slug: string;
	name: string;
}

const daily = fixture<{ mountain: Mountain }>('daily-mountain.json');
const permalinkFixtures = [
	'mountain-complete.json',
	'mountain-sparse.json',
	'mountain-minimal.json'
].map((name) => fixture<Mountain>(name));

const LOAD_FAILED = "We couldn't load the mountain";

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('daily page', () => {
	test("serves today's mountain with its title, heading and no-store", async ({ request }) => {
		const response = await request.get('/');
		const html = await response.text();

		expect(response.status()).toBe(200);
		expect(response.headers()['cache-control']).toBe('no-store');
		expect(titleOf(html)).toBe(`Today's discovery: ${daily.mountain.name} · SerendiPeak`);
		expect(headingsOf(html)).toEqual([daily.mountain.name]);
	});

	test('answers 503 with no-store when the API is unreachable', async ({ request }) => {
		await useScenario(request, 'unreachable');

		const response = await request.get('/');
		const html = await response.text();

		expect(response.status()).toBe(503);
		expect(response.headers()['cache-control']).toBe('no-store');
		expect(titleOf(html)).toBe(`${LOAD_FAILED} · SerendiPeak`);
		expect(headingsOf(html)).toEqual([LOAD_FAILED]);
		expect(hasTryAgain(html)).toBe(true);
	});

	test('answers 503 with no-store when no mountain is eligible', async ({ request }) => {
		await useScenario(request, 'no-eligible');

		const response = await request.get('/');
		const html = await response.text();

		expect(response.status()).toBe(503);
		expect(response.headers()['cache-control']).toBe('no-store');
		expect(headingsOf(html)).toEqual([LOAD_FAILED]);
		expect(hasTryAgain(html)).toBe(true);
	});

	test('answers 502 with no-store for a malformed payload', async ({ request }) => {
		await useScenario(request, 'malformed');

		const response = await request.get('/');
		const html = await response.text();

		expect(response.status()).toBe(502);
		expect(response.headers()['cache-control']).toBe('no-store');
		expect(headingsOf(html)).toEqual([LOAD_FAILED]);
		expect(hasTryAgain(html)).toBe(true);
	});

	test('answers 502 with no-store for a backend failure', async ({ request }) => {
		await useScenario(request, 'server-error');

		const response = await request.get('/');

		expect(response.status()).toBe(502);
		expect(response.headers()['cache-control']).toBe('no-store');
	});

	test('offers no link back to itself on the error view', async ({ request }) => {
		await useScenario(request, 'unreachable');

		const html = await (await request.get('/')).text();

		expect(html).not.toContain('Go to today&#x27;s mountain');
	});
});

test.describe('permalink page', () => {
	for (const mountain of permalinkFixtures) {
		test(`serves ${mountain.slug} with its title and heading`, async ({ request }) => {
			const response = await request.get(`/mountains/${mountain.slug}`);
			const html = await response.text();

			expect(response.status()).toBe(200);
			expect(titleOf(html)).toBe(`${mountain.name} · SerendiPeak`);
			expect(headingsOf(html)).toEqual([mountain.name]);
		});
	}

	test('does not mark a found permalink as publicly cacheable', async ({ request }) => {
		const response = await request.get(`/mountains/${permalinkFixtures[0]?.slug}`);

		expect(response.headers()['cache-control'] ?? '').not.toMatch(/public|s-maxage/);
	});

	test('answers 404 with the mountain-not-found view for an unknown slug', async ({ request }) => {
		const response = await request.get('/mountains/nowhere');
		const html = await response.text();

		expect(response.status()).toBe(404);
		expect(titleOf(html)).toBe('Mountain not found · SerendiPeak');
		expect(headingsOf(html)).toEqual(['Mountain not found']);
		expect(hasTryAgain(html)).toBe(false);
		expect(html).toContain('href="/"');
	});

	test('answers 503 when the API is unreachable', async ({ request }) => {
		await useScenario(request, 'unreachable');

		const response = await request.get('/mountains/aconcagua');
		const html = await response.text();

		expect(response.status()).toBe(503);
		expect(titleOf(html)).toBe(`${LOAD_FAILED} · SerendiPeak`);
		expect(headingsOf(html)).toEqual([LOAD_FAILED]);
		expect(hasTryAgain(html)).toBe(true);
	});

	test('answers 502 for a malformed payload', async ({ request }) => {
		await useScenario(request, 'malformed');

		const response = await request.get('/mountains/aconcagua');
		const html = await response.text();

		expect(response.status()).toBe(502);
		expect(headingsOf(html)).toEqual([LOAD_FAILED]);
		expect(hasTryAgain(html)).toBe(true);
	});

	test('answers 502 for a backend failure', async ({ request }) => {
		await useScenario(request, 'server-error');

		const response = await request.get('/mountains/aconcagua');

		expect(response.status()).toBe(502);
	});

	for (const reserved of ['today', 'random']) {
		test(`answers 404 for /mountains/${reserved} without calling the API`, async ({ request }) => {
			const response = await request.get(`/mountains/${reserved}`);
			const html = await response.text();

			expect(response.status()).toBe(404);
			expect(headingsOf(html)).toEqual(['Mountain not found']);
			expect(await stubRequests(request)).toEqual([]);
		});
	}

	test('treats a percent-encoded reserved slug as reserved', async ({ request }) => {
		const response = await request.get('/mountains/%74oday');

		expect(response.status()).toBe(404);
		expect(await stubRequests(request)).toEqual([]);
	});
});

test.describe('unknown routes', () => {
	test('answer 404 with the page-not-found view', async ({ request }) => {
		const response = await request.get('/atlas');
		const html = await response.text();

		expect(response.status()).toBe(404);
		expect(titleOf(html)).toBe('Page not found · SerendiPeak');
		expect(headingsOf(html)).toEqual(['Page not found']);
		expect(hasTryAgain(html)).toBe(false);
	});
});

test.describe('stub API', () => {
	test('survives a malformed percent-encoded slug', async ({ request }) => {
		const response = await request.get('/mountains/%E0%A4%A');

		expect(response.status()).toBeLessThan(500);
		expect(await request.get('/')).toBeOK();
	});
});
