import { describe, expect, it } from 'vitest';
import type { MountainIndexEntry } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import { NEARBY_LIMIT, NEARBY_MAX_DISTANCE_KM, findNearbyMountains } from './findNearbyMountains';

function at(
	slug: string,
	latitude: number,
	longitude: number,
	overrides: Partial<MountainIndexEntry> = {}
): MountainIndexEntry {
	return indexEntry(slug, slug.toUpperCase(), {
		coordinates: { latitude, longitude },
		...overrides
	});
}

const ORIGIN = { slug: 'origin', coordinates: { latitude: 0, longitude: 0 } };

// One degree of latitude along a meridian is about 111.2 km.
const slugs = (found: { slug: string }[]) => found.map(({ slug }) => slug);

describe('findNearbyMountains', () => {
	it('keeps the radius and the limit the product asked for', () => {
		expect(NEARBY_MAX_DISTANCE_KM).toBe(1000);
		expect(NEARBY_LIMIT).toBe(3);
	});

	it('orders by ascending distance', () => {
		const index = [at('far', 5, 0), at('near', 1, 0), at('middle', 3, 0)];

		expect(slugs(findNearbyMountains(ORIGIN, index))).toEqual(['near', 'middle', 'far']);
	});

	it('excludes the current mountain', () => {
		const index = [at('origin', 0, 0), at('other', 1, 0)];

		expect(slugs(findNearbyMountains(ORIGIN, index))).toEqual(['other']);
	});

	it('is not the current mountain merely for sharing its coordinates', () => {
		const index = [at('twin', 0, 0)];

		const [twin] = findNearbyMountains(ORIGIN, index);

		expect(twin?.slug).toBe('twin');
		expect(twin?.distanceKm).toBe(0);
	});

	it('returns at most three, the closest ones', () => {
		const index = [at('d', 4, 0), at('b', 2, 0), at('a', 1, 0), at('c', 3, 0), at('e', 5, 0)];

		expect(slugs(findNearbyMountains(ORIGIN, index))).toEqual(['a', 'b', 'c']);
	});

	it('honours a limit and a radius given by the caller', () => {
		const index = [at('a', 1, 0), at('b', 2, 0), at('c', 3, 0)];

		expect(slugs(findNearbyMountains(ORIGIN, index, { limit: 1 }))).toEqual(['a']);
		expect(slugs(findNearbyMountains(ORIGIN, index, { maxDistanceKm: 250 }))).toEqual(['a', 'b']);
		expect(findNearbyMountains(ORIGIN, index, { limit: 0 })).toEqual([]);
	});

	it('keeps a mountain exactly on the radius and drops one just past it', () => {
		const index = [at('inside', 1, 0), at('outside', 1.0001, 0)];
		const [inside] = findNearbyMountains(ORIGIN, index);
		const radius = inside?.distanceKm ?? 0;

		expect(slugs(findNearbyMountains(ORIGIN, index, { maxDistanceKm: radius }))).toEqual([
			'inside'
		]);
	});

	it('applies the 1,000 km radius: 8° of latitude is in, 9.5° is out', () => {
		const index = [at('in', 8, 0), at('out', 9.5, 0)];

		expect(slugs(findNearbyMountains(ORIGIN, index))).toEqual(['in']);
	});

	it('does not pad the list with distant mountains, and may be empty', () => {
		expect(findNearbyMountains(ORIGIN, [at('far', 40, 0), at('farther', -60, 100)])).toEqual([]);
		expect(findNearbyMountains(ORIGIN, [])).toEqual([]);
	});

	it('breaks equal distances by slug, whatever the order of the index', () => {
		const north = at('b-north', 1, 0);
		const south = at('a-south', -1, 0);
		const east = at('c-east', 0, 1);

		const forward = findNearbyMountains(
			{ slug: 'origin', coordinates: { latitude: 0, longitude: 0 } },
			[north, south]
		);
		const reversed = findNearbyMountains(
			{ slug: 'origin', coordinates: { latitude: 0, longitude: 0 } },
			[south, north]
		);

		expect(slugs(forward)).toEqual(['a-south', 'b-north']);
		expect(slugs(reversed)).toEqual(['a-south', 'b-north']);
		expect(slugs(findNearbyMountains(ORIGIN, [east, north, south])).sort()).toEqual([
			'a-south',
			'b-north',
			'c-east'
		]);
	});

	it('finds mountains across the antimeridian, near either side of it', () => {
		const origin = { slug: 'taveuni', coordinates: { latitude: -16.8, longitude: 179.9 } };
		const index = [
			at('across', -16.8, -179.9),
			at('same-side', -16.8, 179.2),
			at('far', -16.8, 100)
		];

		const found = findNearbyMountains(origin, index);

		expect(slugs(found)).toEqual(['across', 'same-side']);
		expect(found[0]?.distanceKm).toBeCloseTo(21.3, 0);
	});

	it('finds mountains across a border and across regions: only distance counts', () => {
		const origin = {
			slug: 'fitz-roy',
			coordinates: { latitude: -49.2713, longitude: -73.0432 }
		};
		const index = [
			at('cerro-torre', -49.2906, -73.099, {
				countries: [{ code: 'CL', name: 'Chile' }],
				region: { slug: 'other', name: 'Another range', ancestors: [] }
			}),
			at('same-country-far', -22, -68, { countries: [{ code: 'AR', name: 'Argentina' }] })
		];

		expect(slugs(findNearbyMountains(origin, index))).toEqual(['cerro-torre']);
	});

	it('returns what the page shows and the exact distance, not a rounded one', () => {
		const [found] = findNearbyMountains(ORIGIN, [
			at('peak', 1, 0, {
				name: 'Peak',
				elevationMeters: 4321,
				countries: [{ code: 'CH', name: 'Switzerland' }]
			})
		]);

		expect(found).toEqual({
			slug: 'peak',
			name: 'Peak',
			place: 'Switzerland',
			elevationMeters: 4321,
			coordinates: { latitude: 1, longitude: 0 },
			distanceKm: expect.closeTo(111.19, 1)
		});
	});

	it('does not change the index it is given', () => {
		const index = [at('b', 2, 0), at('a', 1, 0)];

		findNearbyMountains(ORIGIN, index);

		expect(slugs(index)).toEqual(['b', 'a']);
	});
});
