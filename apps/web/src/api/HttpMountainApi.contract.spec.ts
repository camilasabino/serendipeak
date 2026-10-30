import { describe, expect, it } from 'vitest';
import type { Mountain } from './contract';
import { HttpMountainApi } from './HttpMountainApi';
import { contractFixture, MOUNTAIN_FIXTURES } from './test-support/contractFixtures';
import { BASE_URL, serving } from './test-support/stubFetch';

const OPTIONAL_FIELDS = [
	'prominenceMeters',
	'rangeName',
	'summary',
	'camera',
	'primaryImage',
	'sources'
] as const;

function apiServing(body: unknown, status = 200) {
	return new HttpMountainApi({ baseUrl: BASE_URL, fetch: serving(body, status) });
}

describe('v1 contract fixtures through HttpMountainApi', () => {
	for (const name of MOUNTAIN_FIXTURES) {
		it(`accepts ${name} from the permalink endpoint unchanged`, async () => {
			const payload = contractFixture(name);

			expect(await apiServing(payload).getMountain('any')).toEqual({
				kind: 'found',
				mountain: payload
			});
		});

		it(`accepts ${name} from the random endpoint unchanged`, async () => {
			const payload = contractFixture(name);

			expect(await apiServing(payload).getRandomMountain('aconcagua')).toEqual({
				kind: 'found',
				mountain: payload
			});
		});
	}

	it('keeps every optional field absent in the minimal mountain', async () => {
		const result = await apiServing(contractFixture('mountain-minimal.json')).getMountain(
			'bare-peak'
		);

		expect(result.kind).toBe('found');
		const mountain = (result as { mountain: Mountain }).mountain;
		for (const field of OPTIONAL_FIELDS) {
			expect(field in mountain, field).toBe(false);
		}
		expect(mountain.countries).toEqual([]);
	});

	it('keeps the sparse mountain without prominence and Wikipedia link', async () => {
		const result = await apiServing(contractFixture('mountain-sparse.json')).getMountain(
			'mount-olympus'
		);

		expect(result.kind).toBe('found');
		const mountain = (result as { mountain: Mountain }).mountain;
		expect('prominenceMeters' in mountain).toBe(false);
		expect(mountain.sources).toBeDefined();
		expect('wikipedia' in mountain.sources!).toBe(false);
		expect(mountain.camera?.framing).toBeDefined();
		expect(mountain.primaryImage?.width).toBeGreaterThan(0);
	});

	it('takes the discovery date from the daily payload', async () => {
		const payload = contractFixture('daily-mountain.json') as { date: string; mountain: unknown };

		expect(await apiServing(payload).getDailyMountain()).toEqual({
			kind: 'found',
			daily: { date: payload.date, mountain: payload.mountain }
		});
	});
});

describe('v1 error envelopes through HttpMountainApi', () => {
	const notFound = contractFixture('error-mountain-not-found.json');
	const noEligible = contractFixture('error-no-eligible-mountains.json');
	const internal = contractFixture('error-internal.json');

	it('maps MOUNTAIN_NOT_FOUND to not-found for the permalink endpoint', async () => {
		expect(await apiServing(notFound, 404).getMountain('nope')).toEqual({ kind: 'not-found' });
	});

	it('maps NO_ELIGIBLE_MOUNTAINS to no-eligible-mountains for daily and random', async () => {
		expect(await apiServing(noEligible, 503).getDailyMountain()).toEqual({
			kind: 'no-eligible-mountains'
		});
		expect(await apiServing(noEligible, 503).getRandomMountain()).toEqual({
			kind: 'no-eligible-mountains'
		});
	});

	it('maps INTERNAL_ERROR to an api-error with its status on every endpoint', async () => {
		const expected = { kind: 'api-error', status: 500 };

		expect(await apiServing(internal, 500).getMountain('aconcagua')).toEqual(expected);
		expect(await apiServing(internal, 500).getDailyMountain()).toEqual(expected);
		expect(await apiServing(internal, 500).getRandomMountain()).toEqual(expected);
	});

	it('does not read an envelope on the wrong endpoint as its own outcome', async () => {
		expect(await apiServing(noEligible, 503).getMountain('aconcagua')).toEqual({
			kind: 'api-error',
			status: 503
		});
		expect(await apiServing(notFound, 404).getDailyMountain()).toEqual({
			kind: 'api-error',
			status: 404
		});
		expect(await apiServing(notFound, 404).getRandomMountain()).toEqual({
			kind: 'api-error',
			status: 404
		});
	});

	it('requires the envelope status as well as the code', async () => {
		expect(await apiServing(notFound, 200).getMountain('nope')).toEqual({
			kind: 'api-error',
			status: 200
		});
		expect(await apiServing(noEligible, 500).getDailyMountain()).toEqual({
			kind: 'api-error',
			status: 500
		});
	});
});

describe('v1 catalog snapshot through HttpMountainApi', () => {
	const snapshot = contractFixture('catalog.json') as {
		mountains: { slug: string; name: string; camera: unknown }[];
	};

	it('freezes the 73 published mountains', () => {
		expect(snapshot.mountains).toHaveLength(73);
		expect(new Set(snapshot.mountains.map((entry) => entry.slug)).size).toBe(73);
	});

	it('accepts the canonical camera of every published mountain', async () => {
		const template = contractFixture('mountain-minimal.json') as object;

		for (const entry of snapshot.mountains) {
			const payload = { ...template, slug: entry.slug, name: entry.name, camera: entry.camera };

			const result = await apiServing(payload).getMountain(entry.slug);

			expect(result.kind, entry.slug).toBe('found');
		}
	});
});
