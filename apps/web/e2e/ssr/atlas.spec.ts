import { expect, test } from '@playwright/test';
import { SITE_ORIGIN } from '../support/ports';
import { fixture, headingsOf, resetStub, stubRequests, titleOf, useScenario } from './support';

interface Named {
	slug: string;
	name: string;
}

const MOUNTAINS = ['mountain-complete.json', 'mountain-sparse.json', 'mountain-minimal.json'].map(
	(name) => fixture<Named>(name)
);
const [ACONCAGUA] = MOUNTAINS as [Named];

function canonicalsOf(html: string): string[] {
	return [...html.matchAll(/<link[^>]*rel="canonical"[^>]*>/g)].map(
		(match) => /href="([^"]*)"/.exec(match[0])?.[1] ?? ''
	);
}

function descriptionOf(html: string): string | undefined {
	return /<meta[^>]*name="description"[^>]*content="([^"]*)"/.exec(html)?.[1];
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('atlas page', () => {
	test('serves every mountain as text and links, with title, description and canonical', async ({
		request
	}) => {
		const response = await request.get('/atlas');
		const html = await response.text();

		expect(response.status()).toBe(200);
		expect(response.headers()['x-robots-tag']).toBeUndefined();
		expect(titleOf(html)).toBe('Atlas · SerendiPeak');
		expect(descriptionOf(html)).toMatch(/Every mountain on SerendiPeak/);
		expect(canonicalsOf(html)).toEqual([`${SITE_ORIGIN}/atlas`]);
		expect(html).not.toMatch(/name="robots"/);
		expect(headingsOf(html)).toEqual(['Atlas']);
		for (const mountain of MOUNTAINS) {
			expect(html).toContain(`href="/mountains/${mountain.slug}"`);
			expect(html).toContain(mountain.name);
		}
		expect(html).not.toMatch(/On the atlas|Fly to|mountain=/);
		expect(await stubRequests(request)).toEqual(['/api/v1/mountains']);
	});

	test('serves every continent collapsed, each named with its count', async ({ request }) => {
		const html = await (await request.get('/atlas')).text();
		const groups = [...html.matchAll(/<details[^>]*>/g)].map((match) => match[0]);
		const summaries = [...html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)].map((match) =>
			match[1]!.replace(/<[^>]+>/g, '')
		);

		expect(groups.length).toBeGreaterThan(0);
		expect(groups.every((tag) => !/\sopen/.test(tag))).toBe(true);
		expect(summaries).toHaveLength(groups.length);
		for (const summary of summaries) {
			expect(summary).toMatch(/^\D+\d+ mountains?$/);
		}
	});

	test('sends a legacy selection link to the mountain page, not for good', async ({ request }) => {
		const response = await request.get(`/atlas?mountain=${ACONCAGUA.slug}`, { maxRedirects: 0 });

		expect(response.status()).toBe(307);
		expect(response.headers()['location']).toBe(`/mountains/${ACONCAGUA.slug}`);
		expect(response.headers()['refresh']).toBeUndefined();
	});

	test('lands a legacy selection link on the mountain page with its own title and no loop', async ({
		request
	}) => {
		const response = await request.get(`/atlas?mountain=${ACONCAGUA.slug}`);
		const html = await response.text();

		expect(response.status()).toBe(200);
		expect(response.url()).toBe(`${new URL(response.url()).origin}/mountains/${ACONCAGUA.slug}`);
		expect(headingsOf(html)).toEqual([ACONCAGUA.name]);
		expect(canonicalsOf(html)).toEqual([]);
	});

	test('lands an unknown legacy selection on the bare atlas with its canonical, once', async ({
		request
	}) => {
		const response = await request.get('/atlas?mountain=removed-peak');
		const html = await response.text();

		expect(response.status()).toBe(200);
		expect(new URL(response.url()).pathname + new URL(response.url()).search).toBe('/atlas');
		expect(canonicalsOf(html)).toEqual([`${SITE_ORIGIN}/atlas`]);
		expect(titleOf(html)).toBe('Atlas · SerendiPeak');
	});

	test('keeps the bare canonical on an atlas reached with unrelated parameters', async ({
		request
	}) => {
		const html = await (await request.get('/atlas?utm_source=mail&q=1')).text();

		expect(canonicalsOf(html)).toEqual([`${SITE_ORIGIN}/atlas`]);
	});

	for (const slug of ['removed-peak', '..%2Ftoday']) {
		test(`sends the legacy selection "${slug}" it does not hold to the bare atlas`, async ({
			request
		}) => {
			const response = await request.get(`/atlas?mountain=${slug}`, { maxRedirects: 0 });

			expect(response.status()).toBe(307);
			expect(response.headers()['location']).toBe('/atlas');
		});
	}

	test('serves the bare atlas for an empty legacy selection, with the bare canonical', async ({
		request
	}) => {
		const response = await request.get('/atlas?mountain=', { maxRedirects: 0 });

		expect(response.status()).toBe(200);
		expect(canonicalsOf(await response.text())).toEqual([`${SITE_ORIGIN}/atlas`]);
	});

	for (const [scenario, status] of [
		['unreachable', 503],
		['server-error', 502],
		['malformed', 502]
	] as const) {
		test(`answers ${scenario} with ${status}, a retry and no canonical`, async ({ request }) => {
			await useScenario(request, scenario);

			const response = await request.get('/atlas');
			const html = await response.text();

			expect(response.status()).toBe(status);
			expect(headingsOf(html)).toEqual(["We couldn't load the atlas"]);
			expect(canonicalsOf(html)).toEqual([]);
		});
	}

	test('leaves mountain pages without a canonical link of their own, as before', async ({
		request
	}) => {
		const html = await (await request.get(`/mountains/${ACONCAGUA.slug}`)).text();

		expect(canonicalsOf(html)).toEqual([]);
		expect(html).toMatch(/<a [^>]*href="\/atlas"[^>]*>[\s\S]*?Back to atlas/);
	});
});
