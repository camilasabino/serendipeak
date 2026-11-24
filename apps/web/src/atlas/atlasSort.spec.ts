import { describe, expect, it } from 'vitest';
import { indexEntry } from '../api/test-support/indexEntries';
import { compareByNameThenSlug, sortMountains } from './atlasSort';

const EUROPE = { code: 'EU', name: 'Europe' };
const ASIA = { code: 'AS', name: 'Asia' };

const MOUNTAINS = [
	indexEntry('eiger', 'Eiger', { elevationMeters: 3967, continent: EUROPE }),
	indexEntry('everest', 'Mount Everest', { elevationMeters: 8849, continent: ASIA }),
	indexEntry('mont-blanc', 'Mont Blanc', { elevationMeters: 4806, continent: EUROPE }),
	indexEntry('lhotse', 'Lhotse', { elevationMeters: 8516, continent: ASIA })
];
const slugs = (list: readonly { slug: string }[]) => list.map(({ slug }) => slug);

describe('sortMountains', () => {
	it('sorts by name across continents, not within them', () => {
		expect(slugs(sortMountains(MOUNTAINS, 'name'))).toEqual([
			'eiger',
			'lhotse',
			'mont-blanc',
			'everest'
		]);
	});

	it('sorts by elevation, highest first or lowest first, across continents', () => {
		expect(slugs(sortMountains(MOUNTAINS, 'elevation-desc'))).toEqual([
			'everest',
			'lhotse',
			'mont-blanc',
			'eiger'
		]);
		expect(slugs(sortMountains(MOUNTAINS, 'elevation-asc'))).toEqual([
			'eiger',
			'mont-blanc',
			'lhotse',
			'everest'
		]);
	});

	it('settles equal elevations by name and then by slug, in either direction', () => {
		const tied = [
			indexEntry('b-2', 'Beta', { elevationMeters: 5000 }),
			indexEntry('b-1', 'Beta', { elevationMeters: 5000 }),
			indexEntry('a', 'alpha', { elevationMeters: 5000 }),
			indexEntry('top', 'Top', { elevationMeters: 6000 })
		];

		expect(slugs(sortMountains(tied, 'elevation-desc'))).toEqual(['top', 'a', 'b-1', 'b-2']);
		expect(slugs(sortMountains(tied, 'elevation-asc'))).toEqual(['a', 'b-1', 'b-2', 'top']);
		expect(slugs(sortMountains(tied, 'name'))).toEqual(['a', 'b-1', 'b-2', 'top']);
	});

	it('gives the same order whatever order the index arrives in', () => {
		const reversed = [...MOUNTAINS].reverse();

		for (const sort of ['name', 'elevation-desc', 'elevation-asc'] as const) {
			expect(slugs(sortMountains(reversed, sort))).toEqual(slugs(sortMountains(MOUNTAINS, sort)));
		}
	});

	it('returns a new array and leaves its input alone', () => {
		const before = slugs(MOUNTAINS);
		const sorted = sortMountains(MOUNTAINS, 'elevation-desc');

		expect(sorted).not.toBe(MOUNTAINS);
		expect(slugs(MOUNTAINS)).toEqual(before);
		expect(sortMountains([], 'name')).toEqual([]);
	});

	it('compares names ignoring accents and case', () => {
		expect(
			compareByNameThenSlug({ name: 'Écrins', slug: 'b' }, { name: 'ecrins', slug: 'a' })
		).toBe(1);
	});
});
