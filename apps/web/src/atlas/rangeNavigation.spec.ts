import { describe, expect, it } from 'vitest';
import type { MountainIndexEntry, Region } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import { atlasOptions, filterMountains, NO_FILTERS } from './atlasFilter';
import {
	continentNames,
	originContinent,
	rangePlace,
	rootRangesByContinent,
	subrangeOf
} from './rangeNavigation';

const ref = (slug: string, name: string) => ({ slug, name });
const region = (slug: string, name: string, ...ancestors: Region['ancestors']): Region => ({
	slug,
	name,
	ancestors
});

const ANDES = ref('andes', 'Andes');
const SOUTHERN_ANDES = ref('southern-andes', 'Southern Andes');
const ALPS = ref('alps', 'Alps');
const SA = { code: 'SA', name: 'South America' };
const AS = { code: 'AS', name: 'Asia' };
const AF = { code: 'AF', name: 'Africa' };

const CATALOG: MountainIndexEntry[] = [
	// Three levels, the middle one holding no mountain of its own.
	indexEntry('aconcagua', 'Aconcagua', {
		continent: SA,
		region: region('principal-cordillera', 'Principal Cordillera', ANDES, SOUTHERN_ANDES)
	}),
	indexEntry('chimborazo', 'Chimborazo', { continent: SA, region: region('andes', 'Andes') }),
	indexEntry('fitz-roy', 'Fitz Roy', {
		continent: SA,
		region: region('patagonian-andes', 'Patagonian Andes', ANDES)
	}),
	indexEntry('everest', 'Mount Everest', {
		continent: AS,
		region: region('mahalangur', 'Mahalangur', ref('himalaya', 'Himalaya'))
	}),
	// One range on two continents.
	indexEntry('kilimanjaro', 'Kilimanjaro', { continent: AF, region: region('rift', 'Rift') }),
	indexEntry('erta-ale', 'Erta Ale', { continent: AS, region: region('rift', 'Rift') }),
	// A single mountain, and a root whose mountains all sit in its subranges.
	indexEntry('triglav', 'Triglav', {
		continent: { code: 'EU', name: 'Europe' },
		region: region('triglav-group', 'Triglav Group')
	}),
	indexEntry('mont-blanc', 'Mont Blanc', {
		continent: { code: 'EU', name: 'Europe' },
		region: region('mont-blanc-massif', 'Mont Blanc massif', ALPS)
	}),
	indexEntry('olympus', 'Mount Olympus', { continent: { code: 'EU', name: 'Europe' } })
];

const ranges = atlasOptions(CATALOG, 'metric').ranges;
const names = (options: readonly { name: string }[]) => options.map(({ name }) => name);

describe('rangePlace', () => {
	it('names the way down from the topmost range, whatever the depth', () => {
		const place = rangePlace(ranges, 'principal-cordillera');

		expect(place?.trail).toEqual([
			ref('andes', 'Andes'),
			ref('southern-andes', 'Southern Andes'),
			ref('principal-cordillera', 'Principal Cordillera')
		]);
		expect(place?.subranges).toEqual([]);
	});

	it('lists the subranges directly below a range, by name, counting what lies under each', () => {
		const place = rangePlace(ranges, 'andes');

		expect(place?.trail).toEqual([ref('andes', 'Andes')]);
		expect(place?.range.count).toBe(3);
		expect(place?.subranges.map(({ name, count }) => [name, count])).toEqual([
			['Patagonian Andes', 1],
			['Southern Andes', 1]
		]);
	});

	it('offers a range with no mountain of its own, and what is below it', () => {
		const place = rangePlace(ranges, 'southern-andes');

		expect(place?.range.count).toBe(1);
		expect(names(place?.subranges ?? [])).toEqual(['Principal Cordillera']);
		expect(place?.trail.map(({ name }) => name)).toEqual(['Andes', 'Southern Andes']);
	});

	it('has no place for a range the catalog does not offer', () => {
		expect(rangePlace(ranges, 'atlantis')).toBeUndefined();
		expect(rangePlace([], 'andes')).toBeUndefined();
	});

	it('counts what choosing each range would leave', () => {
		for (const { slug, count } of ranges) {
			const place = rangePlace(ranges, slug);

			expect(place?.range.count).toBe(count);
			expect(filterMountains(CATALOG, { ...NO_FILTERS, range: slug })).toHaveLength(count);
		}
	});
});

describe('rootRangesByContinent', () => {
	const byContinent = rootRangesByContinent(CATALOG, ranges);
	const slugsOf = (code: string) => (byContinent.get(code) ?? []).map(({ slug }) => slug);

	it('lists each continent’s topmost ranges by name, one however few mountains it holds', () => {
		expect(slugsOf('SA')).toEqual(['andes']);
		expect(slugsOf('EU')).toEqual(['alps', 'triglav-group']);
		expect(slugsOf('AS')).toEqual(['himalaya', 'rift']);
	});

	it('lists a range whose mountains all sit in its subranges', () => {
		expect(slugsOf('EU')).toContain('alps');
		expect(byContinent.get('EU')?.find(({ slug }) => slug === 'alps')?.count).toBe(1);
	});

	it('lists a range on every continent it reaches, with the count choosing it leaves', () => {
		expect(slugsOf('AF')).toEqual(['rift']);
		expect(byContinent.get('AF')?.[0]?.count).toBe(2);
		expect(byContinent.get('AS')?.find(({ slug }) => slug === 'rift')?.count).toBe(2);
	});

	it('never lists a subrange as a topmost one, nor a mountain without a region', () => {
		const listed = [...byContinent.values()].flat().map(({ slug }) => slug);

		expect(listed).not.toContain('patagonian-andes');
		expect(listed).not.toContain('southern-andes');
		expect(byContinent.size).toBe(4);
	});

	it('leaves every offered range reachable: a topmost one is listed, any other is below its parent', () => {
		const listed = new Set([...byContinent.values()].flat().map(({ slug }) => slug));

		for (const { slug, parent } of ranges) {
			if (parent === null) {
				expect(listed.has(slug)).toBe(true);
			} else {
				expect(rangePlace(ranges, parent)?.subranges.map((range) => range.slug)).toContain(slug);
			}
		}
	});

	it('lists nothing for a catalog without regions', () => {
		const bare = [indexEntry('olympus', 'Mount Olympus')];

		expect(rootRangesByContinent(bare, atlasOptions(bare, 'metric').ranges).size).toBe(0);
	});
});

describe('subrangeOf', () => {
	const mountain = (slug: string) => CATALOG.find((entry) => entry.slug === slug)!;

	it('names the subrange directly below the selected range that holds the mountain', () => {
		expect(subrangeOf(mountain('aconcagua'), 'andes')).toBe('Southern Andes');
		expect(subrangeOf(mountain('aconcagua'), 'southern-andes')).toBe('Principal Cordillera');
		expect(subrangeOf(mountain('fitz-roy'), 'andes')).toBe('Patagonian Andes');
	});

	it('says nothing for a mountain that sits in the selected range itself', () => {
		expect(subrangeOf(mountain('chimborazo'), 'andes')).toBeUndefined();
		expect(subrangeOf(mountain('aconcagua'), 'principal-cordillera')).toBeUndefined();
	});

	it('says nothing for a mountain outside the selected range or without a region', () => {
		expect(subrangeOf(mountain('everest'), 'andes')).toBeUndefined();
		expect(subrangeOf(mountain('olympus'), 'andes')).toBeUndefined();
	});
});

describe('continentNames', () => {
	it('lists each continent once, alphabetically', () => {
		expect(continentNames(CATALOG)).toEqual(['Africa', 'Asia', 'Europe', 'South America']);
		expect(continentNames([])).toEqual([]);
	});
});

describe('originContinent', () => {
	const rift = CATALOG.filter(({ region }) => region?.slug === 'rift');
	const andes = CATALOG.filter(({ continent }) => continent.code === 'SA');

	it('is the continent the reader browsed, with the level of it they came from', () => {
		expect(originContinent(rift, { code: 'AF', ranges: true })).toEqual({ ...AF, ranges: true });
		expect(originContinent(rift, { code: 'AS', ranges: false })).toEqual({ ...AS, ranges: false });
	});

	it('is none when no continent was browsed, even for a range that lies on only one', () => {
		expect(originContinent(andes, null)).toBeUndefined();
		expect(originContinent(rift, null)).toBeUndefined();
		expect(originContinent([], null)).toBeUndefined();
	});

	it('is none when the continent browsed holds none of the range, rather than a step never taken', () => {
		expect(originContinent(andes, { code: 'AS', ranges: true })).toBeUndefined();
		expect(originContinent(rift, { code: 'SA', ranges: false })).toBeUndefined();
	});
});
