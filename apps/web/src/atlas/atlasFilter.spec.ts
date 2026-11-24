import { describe, expect, it } from 'vitest';
import type { MountainIndexEntry, Region } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import type { UnitSystem } from '../units/unitSystem';
import {
	NO_FILTERS,
	activeFilterCount,
	atlasOptions as optionsIn,
	facetedOptions as facetedIn,
	filterMountains,
	settleFilters,
	type AtlasFilters
} from './atlasFilter';
import { bandFloorOf, bandSelection } from './elevationBands';

const ANDES = { slug: 'andes', name: 'Andes' };
const SOUTHERN = { slug: 'southern-andes', name: 'Southern Andes' };
const HIMALAYA = { slug: 'himalaya', name: 'Himalaya' };

function region(slug: string, name: string, ...ancestors: Region['ancestors']): Region {
	return { slug, name, ancestors };
}

const AR = { code: 'AR', name: 'Argentina' };
const CL = { code: 'CL', name: 'Chile' };
const NP = { code: 'NP', name: 'Nepal' };
const CN = { code: 'CN', name: 'China' };

const ACONCAGUA = indexEntry('aconcagua', 'Aconcagua', {
	countries: [AR],
	elevationMeters: 6961,
	region: region('principal-cordillera', 'Principal Cordillera', ANDES, SOUTHERN)
});
const FITZ_ROY = indexEntry('fitz-roy', 'Fitz Roy', {
	countries: [AR, CL],
	elevationMeters: 3405,
	region: region('patagonian-andes', 'Patagonian Andes', ANDES)
});
const EVEREST = indexEntry('everest', 'Mount Everest', {
	countries: [NP, CN],
	elevationMeters: 8849,
	region: region('mahalangur', 'Mahalangur', HIMALAYA)
});
const OLYMPUS = indexEntry('olympus', 'Mount Olympus', {
	countries: [{ code: 'GR', name: 'Greece' }],
	elevationMeters: 2918,
	region: null
});
const ANDES_ITSELF = indexEntry('andes-peak', 'Andes Peak', {
	countries: [AR],
	elevationMeters: 4100,
	region: region('andes', 'Andes')
});
const CATALOG = [ACONCAGUA, FITZ_ROY, EVEREST, OLYMPUS, ANDES_ITSELF];

const slugs = (mountains: readonly MountainIndexEntry[]) => mountains.map(({ slug }) => slug);
const only = (change: Partial<AtlasFilters>): AtlasFilters => ({ ...NO_FILTERS, ...change });
const m = (...floors: number[]) => bandSelection('metric', floors);
const ft = (...floors: number[]) => bandSelection('imperial', floors);
const atlasOptions = (mountains: readonly MountainIndexEntry[], system: UnitSystem = 'metric') =>
	optionsIn(mountains, system);
const facetedOptions = (
	mountains: readonly MountainIndexEntry[],
	filters: AtlasFilters,
	system: UnitSystem = 'metric'
) => facetedIn(mountains, filters, system);

describe('country filter', () => {
	it('matches a mountain by any of its countries, so a cross-border peak shows under each', () => {
		expect(slugs(filterMountains(CATALOG, only({ country: 'AR' })))).toEqual([
			'aconcagua',
			'fitz-roy',
			'andes-peak'
		]);
		expect(slugs(filterMountains(CATALOG, only({ country: 'CL' })))).toEqual(['fitz-roy']);
		expect(slugs(filterMountains(CATALOG, only({ country: 'CN' })))).toEqual(['everest']);
	});

	it('leaves out a mountain that lists no country', () => {
		const stateless = indexEntry('stateless', 'Stateless', { countries: [] });

		expect(slugs(filterMountains([stateless, FITZ_ROY], only({ country: 'AR' })))).toEqual([
			'fitz-roy'
		]);
		expect(slugs(filterMountains([stateless, FITZ_ROY], NO_FILTERS))).toEqual([
			'stateless',
			'fitz-roy'
		]);
	});

	it('offers each country once, alphabetically by name, whichever mountain lists it first', () => {
		expect(atlasOptions(CATALOG).countries.map(({ code }) => code)).toEqual([
			'AR',
			'CL',
			'CN',
			'GR',
			'NP'
		]);
	});
});

describe('elevation filter', () => {
	it.each([
		[5999, 5000],
		[5999.9, 5000],
		[6000, 6000],
		[6999, 6000],
		[6999.9, 6000],
		[7000, 7000],
		[0, 0],
		[999, 0]
	])(
		'puts %d m in the band from %d m, lower bound inclusive and upper exclusive',
		(meters, band) => {
			expect(bandFloorOf(meters, 'metric')).toBe(band);
		}
	);

	it('keeps exactly the mountains from the lower bound up to, not including, the next thousand', () => {
		const at = (slug: string, elevationMeters: number) =>
			indexEntry(slug, slug, { elevationMeters });
		const edge = [
			at('below', 5999),
			at('lower', 6000),
			at('inside', 6500),
			at('upper', 6999),
			at('next', 7000)
		];

		expect(slugs(filterMountains(edge, only({ elevationBands: m(6000) })))).toEqual([
			'lower',
			'inside',
			'upper'
		]);
	});

	it('does not drop the mountains below 4,000 m: they get bands of their own', () => {
		expect(atlasOptions(CATALOG).elevationBands.map(({ floor }) => floor)).toEqual([
			8000, 6000, 4000, 3000, 2000
		]);
		expect(slugs(filterMountains(CATALOG, only({ elevationBands: m(2000) })))).toEqual(['olympus']);
		expect(slugs(filterMountains(CATALOG, NO_FILTERS))).toContain('olympus');
	});

	it('offers only the bands that hold a mountain, highest first', () => {
		const at = (slug: string, elevationMeters: number) =>
			indexEntry(slug, slug, { elevationMeters });

		expect(atlasOptions([at('a', 1200), at('b', 8100), at('c', 1900)]).elevationBands).toEqual([
			{ floor: 8000, count: 1 },
			{ floor: 1000, count: 2 }
		]);
	});
});

describe('mountain range filter', () => {
	it("matches a mountain's own region", () => {
		expect(slugs(filterMountains(CATALOG, only({ range: 'principal-cordillera' })))).toEqual([
			'aconcagua'
		]);
	});

	it('matches through an ancestor at any depth: Andes holds every descendant region', () => {
		expect(slugs(filterMountains(CATALOG, only({ range: 'andes' })))).toEqual([
			'aconcagua',
			'fitz-roy',
			'andes-peak'
		]);
		expect(slugs(filterMountains(CATALOG, only({ range: 'southern-andes' })))).toEqual([
			'aconcagua'
		]);
	});

	it('matches an ancestor deeper than two levels', () => {
		const deep = indexEntry('deep', 'Deep', {
			region: region(
				'leaf',
				'Leaf',
				{ slug: 'root', name: 'Root' },
				{ slug: 'a', name: 'A' },
				{ slug: 'b', name: 'B' }
			)
		});

		for (const slug of ['root', 'a', 'b', 'leaf']) {
			expect(slugs(filterMountains([deep, OLYMPUS], only({ range: slug })))).toEqual(['deep']);
		}
	});

	it('shows a mountain with no region while no range is chosen, and only then', () => {
		expect(slugs(filterMountains(CATALOG, NO_FILTERS))).toContain('olympus');
		expect(slugs(filterMountains(CATALOG, only({ range: 'andes' })))).not.toContain('olympus');
		expect(slugs(filterMountains(CATALOG, only({ range: 'himalaya' })))).toEqual(['everest']);
	});

	it('lists every region and ancestor once, parents before their children and siblings by name', () => {
		expect(atlasOptions(CATALOG).ranges.map(({ slug, depth }) => [slug, depth])).toEqual([
			['andes', 0],
			['patagonian-andes', 1],
			['southern-andes', 1],
			['principal-cordillera', 2],
			['himalaya', 0],
			['mahalangur', 1]
		]);
	});

	it('keeps the names of the ancestors above each range, root first', () => {
		const north = indexEntry('n', 'N', {
			region: region('north-ridge', 'Ridge', { slug: 'north', name: 'North' })
		});
		const south = indexEntry('s', 'S', {
			region: region('south-ridge', 'Ridge', { slug: 'south', name: 'South' })
		});

		expect(
			atlasOptions([north, south]).ranges.map(({ name, ancestors }) => [name, ancestors])
		).toEqual([
			['North', []],
			['Ridge', ['North']],
			['South', []],
			['Ridge', ['South']]
		]);
	});

	it('has no range options when no mountain has a region', () => {
		expect(atlasOptions([OLYMPUS]).ranges).toEqual([]);
	});
});

describe('combined filters', () => {
	it('keeps only what passes every active filter', () => {
		expect(slugs(filterMountains(CATALOG, only({ country: 'AR', range: 'andes' })))).toEqual([
			'aconcagua',
			'fitz-roy',
			'andes-peak'
		]);
		expect(
			slugs(
				filterMountains(CATALOG, only({ country: 'AR', range: 'andes', elevationBands: m(6000) }))
			)
		).toEqual(['aconcagua']);
		expect(
			slugs(filterMountains(CATALOG, only({ country: 'CL', elevationBands: m(6000) })))
		).toEqual([]);
	});

	it('is empty when the filters share no mountain, and never errors on an empty catalog', () => {
		expect(filterMountains(CATALOG, only({ country: 'NP', range: 'andes' }))).toEqual([]);
		expect(filterMountains([], only({ country: 'AR' }))).toEqual([]);
		expect(atlasOptions([])).toEqual({
			countries: [],
			elevationBands: [],
			retainedBands: [],
			ranges: []
		});
	});

	it('returns the catalog itself when nothing is on, so defaults change nothing', () => {
		expect(filterMountains(CATALOG, NO_FILTERS)).toBe(CATALOG);
		expect(activeFilterCount(NO_FILTERS)).toBe(0);
		expect(activeFilterCount(only({ country: 'AR', range: 'andes' }))).toBe(2);
	});

	it('does not modify the catalog it filters', () => {
		const before = slugs(CATALOG);
		filterMountains(CATALOG, only({ country: 'AR' }));

		expect(slugs(CATALOG)).toEqual(before);
	});
});

describe('option counts', () => {
	it('counts each country by every mountain that lists it, so a border peak counts under both', () => {
		expect(atlasOptions(CATALOG).countries.map(({ code, count }) => [code, count])).toEqual([
			['AR', 3],
			['CL', 1],
			['CN', 1],
			['GR', 1],
			['NP', 1]
		]);
	});

	it('counts a band by its exact bounds: 5,999 m and 6,000 m fall in different bands', () => {
		const at = (slug: string, elevationMeters: number) =>
			indexEntry(slug, slug, { elevationMeters });
		const bands = atlasOptions([
			at('a', 5999),
			at('b', 6000),
			at('c', 6999),
			at('d', 7000)
		]).elevationBands;

		expect(bands).toEqual([
			{ floor: 7000, count: 1 },
			{ floor: 6000, count: 2 },
			{ floor: 5000, count: 1 }
		]);
	});

	it('counts a range with every mountain of its subregions', () => {
		const counts = Object.fromEntries(
			atlasOptions(CATALOG).ranges.map(({ slug, count }) => [slug, count])
		);

		expect(counts).toMatchObject({
			andes: 3,
			'southern-andes': 1,
			'patagonian-andes': 1,
			'principal-cordillera': 1,
			himalaya: 1
		});
	});

	it('counts exactly what choosing the option would leave', () => {
		for (const range of atlasOptions(CATALOG).ranges) {
			expect(filterMountains(CATALOG, only({ range: range.slug }))).toHaveLength(range.count);
		}
		for (const { floor, count } of atlasOptions(CATALOG).elevationBands) {
			expect(filterMountains(CATALOG, only({ elevationBands: m(floor) }))).toHaveLength(count);
		}
	});
});

describe('faceted options', () => {
	const codes = (filters: AtlasFilters) =>
		facetedOptions(CATALOG, filters).countries.map(({ code }) => code);
	const floors = (filters: AtlasFilters) =>
		facetedOptions(CATALOG, filters).elevationBands.map(({ floor }) => floor);
	const ranges = (filters: AtlasFilters) =>
		facetedOptions(CATALOG, filters).ranges.map(({ slug }) => slug);

	it('offers everything while nothing is chosen', () => {
		expect(facetedOptions(CATALOG, NO_FILTERS)).toEqual(atlasOptions(CATALOG));
	});

	it('narrows elevation and range to the chosen country, and keeps its own options whole', () => {
		const greece = only({ country: 'GR' });

		expect(floors(greece)).toEqual([2000]);
		expect(ranges(greece)).toEqual([]);
		expect(codes(greece)).toEqual(codes(NO_FILTERS));
	});

	it('narrows countries to those with mountains of the chosen elevation, in either order', () => {
		expect(codes(only({ elevationBands: m(6000) }))).toEqual(['AR']);
		expect(codes(only({ elevationBands: m(8000) }))).toEqual(['CN', 'NP']);
		expect(ranges(only({ elevationBands: m(6000) }))).toEqual([
			'andes',
			'southern-andes',
			'principal-cordillera'
		]);
	});

	it('gives a range the options of its subregions and their ancestors only', () => {
		const andes = only({ range: 'andes' });

		expect(codes(andes)).toEqual(['AR', 'CL']);
		expect(floors(andes)).toEqual([6000, 4000, 3000]);
	});

	it('excludes a facet from its own narrowing, so the choice can always be changed', () => {
		const filters = only({ country: 'AR', elevationBands: m(6000) });

		expect(codes(filters)).toEqual(['AR']);
		expect(floors(filters)).toEqual([6000, 4000, 3000]);
	});

	it('combines the two other filters for the third facet', () => {
		const filters = only({ country: 'AR', range: 'andes' });

		expect(floors(filters)).toEqual([6000, 4000, 3000]);
		expect(floors(only({ country: 'AR', range: 'patagonian-andes' }))).toEqual([3000]);
		expect(ranges(only({ country: 'CL', elevationBands: m(3000) }))).toEqual([
			'andes',
			'patagonian-andes'
		]);
	});

	it('counts each option against the narrowed set', () => {
		const argentina = facetedOptions(CATALOG, only({ elevationBands: m(6000) })).countries;

		expect(argentina).toEqual([{ code: 'AR', name: 'Argentina', count: 1 }]);
	});

	it('has the same options for the same selections whichever order they were made in', () => {
		const final = only({ country: 'AR', elevationBands: m(6000), range: 'andes' });
		const viaCountryFirst = settleFilters(
			CATALOG,
			{
				...settleFilters(CATALOG, only({ country: 'AR' }), 'country').filters,
				elevationBands: m(6000),
				range: 'andes'
			},
			'range'
		).filters;

		expect(viaCountryFirst).toEqual(final);
		expect(facetedOptions(CATALOG, viaCountryFirst)).toEqual(facetedOptions(CATALOG, final));
	});

	it('offers only options that leave a mountain', () => {
		for (const filters of [
			NO_FILTERS,
			only({ country: 'AR' }),
			only({ range: 'andes', elevationBands: m(3000) }),
			only({ country: 'NP', elevationBands: m(8000) })
		]) {
			const options = facetedOptions(CATALOG, filters);
			for (const { code, count } of options.countries) {
				expect(count).toBeGreaterThan(0);
				expect(filterMountains(CATALOG, { ...filters, country: code })).toHaveLength(count);
			}
			for (const { floor, count } of options.elevationBands) {
				expect(filterMountains(CATALOG, { ...filters, elevationBands: m(floor) })).toHaveLength(
					count
				);
			}
			for (const { slug, count } of options.ranges) {
				expect(filterMountains(CATALOG, { ...filters, range: slug })).toHaveLength(count);
			}
		}
	});

	it('has no options at all for an empty catalog', () => {
		expect(facetedOptions([], NO_FILTERS)).toEqual({
			countries: [],
			elevationBands: [],
			retainedBands: [],
			ranges: []
		});
	});
});

describe('settleFilters', () => {
	it('keeps a consistent selection, as the same object', () => {
		const filters = only({ country: 'AR', elevationBands: m(6000), range: 'andes' });
		const settled = settleFilters(CATALOG, filters, 'range');

		expect(settled.filters).toBe(filters);
		expect(settled.reset).toEqual([]);
	});

	it('resets only the selection a new choice makes impossible, and keeps the choice', () => {
		const choice = settleFilters(
			CATALOG,
			only({ country: 'GR', elevationBands: m(6000) }),
			'country'
		);

		expect(choice.filters).toEqual(only({ country: 'GR' }));
		expect(choice.reset).toEqual(['elevationBands']);
	});

	it('keeps the latest choice whichever filter it is', () => {
		const elevation = settleFilters(
			CATALOG,
			only({ country: 'GR', elevationBands: m(6000) }),
			'elevationBands'
		);
		expect(elevation.filters).toEqual(only({ elevationBands: m(6000) }));
		expect(elevation.reset).toEqual(['country']);

		const range = settleFilters(CATALOG, only({ country: 'NP', range: 'andes' }), 'range');
		expect(range.filters).toEqual(only({ range: 'andes' }));
		expect(range.reset).toEqual(['country']);
	});

	it('when three filters cannot all hold, drops the later one in a fixed order and never all', () => {
		// Elevation and range exclude each other here (no 3,000 m peak in Principal Cordillera).
		const filters = only({ country: 'AR', elevationBands: m(3000), range: 'principal-cordillera' });
		const settled = settleFilters(CATALOG, filters, 'country');

		expect(settled.reset).toEqual(['range']);
		expect(filterMountains(CATALOG, settled.filters).length).toBeGreaterThan(0);
		expect(settled.filters).toEqual(only({ country: 'AR', elevationBands: m(3000) }));
	});

	it('resets several at once when a choice excludes them all', () => {
		const settled = settleFilters(
			CATALOG,
			only({ country: 'NP', elevationBands: m(2000), range: 'andes' }),
			'country'
		);

		expect(settled.filters).toEqual(only({ country: 'NP' }));
		expect(settled.reset).toEqual(['elevationBands', 'range']);
	});

	it('settles to the same result when settled again', () => {
		const once = settleFilters(
			CATALOG,
			only({ country: 'GR', elevationBands: m(6000), range: 'andes' }),
			'country'
		);
		const twice = settleFilters(CATALOG, once.filters, 'country');

		expect(twice.filters).toBe(once.filters);
		expect(twice.reset).toEqual([]);
	});

	it('drops a selection the catalog no longer holds, and leaves the others', () => {
		const settled = settleFilters(CATALOG, only({ country: 'XX', elevationBands: m(6000) }), null);

		expect(settled.filters).toEqual(only({ elevationBands: m(6000) }));
		expect(settled.reset).toEqual(['country']);
	});

	it('can change a filter back to all without resetting anything', () => {
		const settled = settleFilters(
			CATALOG,
			only({ country: null, elevationBands: m(6000) }),
			'country'
		);

		expect(settled.reset).toEqual([]);
	});
});

describe('elevation as a set of bands', () => {
	const codes = (filters: AtlasFilters) =>
		facetedOptions(CATALOG, filters).countries.map(({ code }) => code);
	const floors = (filters: AtlasFilters) =>
		facetedOptions(CATALOG, filters).elevationBands.map(({ floor }) => floor);
	const ranges = (filters: AtlasFilters) =>
		facetedOptions(CATALOG, filters).ranges.map(({ slug }) => slug);

	it('matches any selected band, including bands that are not adjacent', () => {
		expect(slugs(filterMountains(CATALOG, only({ elevationBands: m(3000, 8000) })))).toEqual([
			'fitz-roy',
			'everest'
		]);
		expect(slugs(filterMountains(CATALOG, only({ elevationBands: m(2000, 6000, 8000) })))).toEqual([
			'aconcagua',
			'everest',
			'olympus'
		]);
	});

	it('keeps the exact edges of each selected band', () => {
		const edge = [
			indexEntry('a', 'A', { elevationMeters: 4999 }),
			indexEntry('b', 'B', { elevationMeters: 5000 }),
			indexEntry('c', 'C', { elevationMeters: 5999 }),
			indexEntry('d', 'D', { elevationMeters: 6000 })
		];

		expect(slugs(filterMountains(edge, only({ elevationBands: m(4000, 6000) })))).toEqual([
			'a',
			'd'
		]);
	});

	it('combines with country and range by AND', () => {
		const filters = only({ country: 'AR', elevationBands: m(3000, 4000, 8000) });

		expect(slugs(filterMountains(CATALOG, filters))).toEqual(['fitz-roy', 'andes-peak']);
		expect(slugs(filterMountains(CATALOG, { ...filters, range: 'patagonian-andes' }))).toEqual([
			'fitz-roy'
		]);
	});

	it('counts as one active filter however many bands it holds', () => {
		expect(activeFilterCount(only({ elevationBands: m(3000, 4000, 6000) }))).toBe(1);
		expect(activeFilterCount(only({ country: 'AR', elevationBands: m(3000, 4000) }))).toBe(2);
	});

	it('offers country and range the union of the selected bands', () => {
		const bands = only({ elevationBands: m(3000, 8000) });

		expect(codes(bands)).toEqual(['AR', 'CL', 'CN', 'NP']);
		expect(ranges(bands)).toEqual(['andes', 'patagonian-andes', 'himalaya', 'mahalangur']);
	});

	it('offers every band that country and range leave, and not the selection itself as a limit', () => {
		expect(floors(only({ country: 'AR', elevationBands: m(3000) }))).toEqual([6000, 4000, 3000]);
		expect(floors(only({ range: 'patagonian-andes', elevationBands: m(3000) }))).toEqual([3000]);
	});

	it('counts each band on its own, not as part of the union', () => {
		const options = facetedOptions(CATALOG, only({ country: 'AR', elevationBands: m(3000) }));

		expect(options.elevationBands.map(({ floor, count }) => [floor, count])).toEqual([
			[6000, 1],
			[4000, 1],
			[3000, 1]
		]);
	});

	it('reaches the same options whichever order the bands were selected in', () => {
		const forward = facetedOptions(CATALOG, only({ elevationBands: m(3000, 8000) }));
		const reversed = facetedOptions(CATALOG, only({ elevationBands: m(8000, 3000) }));

		expect(reversed).toEqual(forward);
	});

	it('removes only the bands a new country or range leaves empty, and keeps the choice', () => {
		const settled = settleFilters(
			CATALOG,
			only({ country: 'AR', elevationBands: m(3000, 4000, 8000) }),
			'country'
		);

		expect(settled.filters).toEqual(only({ country: 'AR', elevationBands: m(3000, 4000) }));
		expect(settled.removedBands).toEqual(m(8000));
		expect(settled.reset).toEqual([]);

		const range = settleFilters(
			CATALOG,
			only({ range: 'patagonian-andes', elevationBands: m(3000, 4000, 6000) }),
			'range'
		);
		expect(range.filters).toEqual(only({ range: 'patagonian-andes', elevationBands: m(3000) }));
		expect(range.removedBands).toEqual(m(4000, 6000));
	});

	it('resets elevation as a whole when none of its bands survives a choice', () => {
		const settled = settleFilters(
			CATALOG,
			only({ country: 'GR', elevationBands: m(6000, 8000) }),
			'country'
		);

		expect(settled.filters).toEqual(only({ country: 'GR' }));
		expect(settled.reset).toEqual(['elevationBands']);
		expect(settled.removedBands).toBeNull();
	});

	it('settles a band set once and for all, whatever the order it was reached in', () => {
		const filters = only({ country: 'AR', elevationBands: m(8000, 3000, 4000), range: 'andes' });
		const once = settleFilters(CATALOG, filters, 'range');
		const again = settleFilters(CATALOG, once.filters, 'range');

		expect(once.filters).toEqual(
			only({ country: 'AR', elevationBands: m(3000, 4000), range: 'andes' })
		);
		expect(again.filters).toBe(once.filters);
		expect(again.removedBands).toBeNull();
	});

	it('removes a band that a kept range empties even when the country alone would allow it', () => {
		const settled = settleFilters(
			CATALOG,
			only({ country: 'AR', elevationBands: m(3000, 6000), range: 'principal-cordillera' }),
			'range'
		);

		expect(settled.filters).toEqual(
			only({ country: 'AR', elevationBands: m(6000), range: 'principal-cordillera' })
		);
		expect(settled.removedBands).toEqual(m(3000));
	});
});

describe('elevation bands in feet', () => {
	const floors = (filters: AtlasFilters, system: UnitSystem = 'imperial') =>
		facetedOptions(CATALOG, filters, system).elevationBands.map(({ floor }) => floor);
	const codes = (filters: AtlasFilters) =>
		facetedOptions(CATALOG, filters, 'imperial').countries.map(({ code }) => code);

	it('offers 1,000 ft bands of their own, from the catalog, highest first', () => {
		expect(atlasOptions(CATALOG, 'imperial').elevationBands).toEqual([
			{ floor: 29_000, count: 1 },
			{ floor: 22_000, count: 1 },
			{ floor: 13_000, count: 1 },
			{ floor: 11_000, count: 1 },
			{ floor: 9000, count: 1 }
		]);
	});

	it('matches any selected band in feet', () => {
		expect(slugs(filterMountains(CATALOG, only({ elevationBands: ft(9000, 29_000) })))).toEqual([
			'everest',
			'olympus'
		]);
	});

	it('narrows and counts across country and range the way metric bands do', () => {
		expect(floors(only({ country: 'AR' }))).toEqual([22_000, 13_000, 11_000]);
		expect(floors(only({ range: 'patagonian-andes' }))).toEqual([11_000]);
		expect(codes(only({ elevationBands: ft(11_000, 22_000) }))).toEqual(['AR', 'CL']);
		expect(
			facetedOptions(CATALOG, only({ range: 'andes', elevationBands: ft(13_000) }), 'imperial')
				.countries
		).toEqual([{ code: 'AR', name: 'Argentina', count: 1 }]);
	});

	it('removes only the bands in feet a new choice leaves empty', () => {
		const settled = settleFilters(
			CATALOG,
			only({ country: 'AR', elevationBands: ft(11_000, 22_000, 29_000) }),
			'country'
		);

		expect(settled.filters).toEqual(only({ country: 'AR', elevationBands: ft(11_000, 22_000) }));
		expect(settled.removedBands).toEqual(ft(29_000));
	});
});

describe('bands kept from the other system', () => {
	const metric = only({ elevationBands: m(3000, 6000) });

	it('stay in force while another system is displayed, matching what they matched', () => {
		const shownInFeet = facetedOptions(CATALOG, metric, 'imperial');

		expect(slugs(filterMountains(CATALOG, metric))).toEqual(['aconcagua', 'fitz-roy']);
		expect(shownInFeet.retainedBands).toEqual([
			{ floor: 6000, count: 1 },
			{ floor: 3000, count: 1 }
		]);
		// The bands offered are the displayed system's own, none standing in for the kept ones.
		expect(shownInFeet.elevationBands.map(({ floor }) => floor)).toEqual([
			29_000, 22_000, 13_000, 11_000, 9000
		]);
	});

	it('are not set apart while their own system is displayed', () => {
		expect(facetedOptions(CATALOG, metric, 'metric').retainedBands).toEqual([]);
		expect(facetedOptions(CATALOG, NO_FILTERS, 'imperial').retainedBands).toEqual([]);
	});

	it('leave the other options what they were in their own system', () => {
		const inMeters = facetedOptions(CATALOG, metric, 'metric');
		const inFeet = facetedOptions(CATALOG, metric, 'imperial');

		expect(inFeet.countries).toEqual(inMeters.countries);
		expect(inFeet.ranges).toEqual(inMeters.ranges);
	});

	it('count against the country and range in force, and lose the bands those empty', () => {
		const chile = only({ country: 'CL', elevationBands: m(3000, 6000) });
		const settled = settleFilters(CATALOG, chile, 'country');

		expect(settled.filters).toEqual(only({ country: 'CL', elevationBands: m(3000) }));
		expect(settled.removedBands).toEqual(m(6000));
		expect(facetedOptions(CATALOG, settled.filters, 'imperial').retainedBands).toEqual([
			{ floor: 3000, count: 1 }
		]);
	});
});
