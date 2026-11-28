import { describe, expect, it } from 'vitest';
import type { MountainIndexEntry } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import { activeFilterSummaries, filterAlternatives } from './activeFilters';
import { NO_FILTERS, WHOLE_ATLAS, facetedOptions, type AtlasScope } from './atlasFilter';
import { bandSelection } from './elevationBands';

const ANDES = { slug: 'andes', name: 'Andes' };
const SA = { code: 'SA', name: 'South America' };
const EU = { code: 'EU', name: 'Europe' };
const AR = { code: 'AR', name: 'Argentina' };
const CL = { code: 'CL', name: 'Chile' };

const CATALOG: MountainIndexEntry[] = [
	indexEntry('aconcagua', 'Aconcagua', {
		continent: SA,
		countries: [AR],
		elevationMeters: 6961,
		region: { slug: 'principal-cordillera', name: 'Principal Cordillera', ancestors: [ANDES] }
	}),
	indexEntry('fitz-roy', 'Fitz Roy', {
		continent: SA,
		countries: [AR, CL],
		elevationMeters: 3405,
		region: { slug: 'patagonian-andes', name: 'Patagonian Andes', ancestors: [ANDES] }
	}),
	indexEntry('eiger', 'Eiger', { continent: EU, elevationMeters: 3967 }),
	indexEntry('triglav', 'Triglav', {
		continent: EU,
		elevationMeters: 2864,
		region: { slug: 'julian-alps', name: 'Julian Alps', ancestors: [] }
	})
];

const optionsFor = (filters = NO_FILTERS, scope: AtlasScope = WHOLE_ATLAS) =>
	facetedOptions(CATALOG, filters, 'metric', scope);

describe('activeFilterSummaries', () => {
	it('is empty while no filter is on', () => {
		expect(activeFilterSummaries(NO_FILTERS, optionsFor())).toEqual([]);
	});

	it('names each filter and what it holds as its own button shows it, in the panel’s order', () => {
		const filters = {
			country: 'AR',
			range: 'patagonian-andes',
			elevationBands: bandSelection('metric', [3000])
		};

		expect(activeFilterSummaries(filters, optionsFor(filters))).toEqual([
			{ key: 'country', filter: 'Country', value: 'Argentina' },
			{ key: 'elevationBands', filter: 'Elevation', value: '3,000–3,999 m' },
			{ key: 'range', filter: 'Mountain range', value: 'Patagonian Andes' }
		]);
	});

	it('counts several bands as one filter with one summary', () => {
		const filters = { ...NO_FILTERS, elevationBands: bandSelection('metric', [3000, 6000]) };

		expect(activeFilterSummaries(filters, optionsFor(filters))).toEqual([
			{ key: 'elevationBands', filter: 'Elevation', value: '2 elevation bands' }
		]);
	});

	it('leaves out a selection the options no longer name, rather than showing a blank', () => {
		const filters = { ...NO_FILTERS, country: 'XX', range: 'gone' };

		expect(activeFilterSummaries(filters, optionsFor())).toEqual([]);
	});
});

describe('filterAlternatives', () => {
	const alternativesAt = (filters = NO_FILTERS, scope: AtlasScope = WHOLE_ATLAS) =>
		filterAlternatives(CATALOG, filters, scope, optionsFor(filters, scope));

	it('offers a choice for every filter across the whole catalog', () => {
		expect(alternativesAt()).toEqual({ country: true, elevationBands: true, range: true });
	});

	it('offers none to country or elevation when every mountain in scope already satisfies each choice', () => {
		const patagonia = { kind: 'range', slug: 'patagonian-andes' } as const;
		const filters = { ...NO_FILTERS, range: 'patagonian-andes' };

		// One mountain, in one band, in both countries: no choice would show fewer.
		expect(alternativesAt(filters, patagonia)).toMatchObject({
			country: false,
			elevationBands: false
		});
	});

	it('treats a range as a place to go, so any range offered is a choice even when it narrows nothing', () => {
		const patagonia = { kind: 'range', slug: 'patagonian-andes' } as const;
		const filters = { ...NO_FILTERS, range: 'patagonian-andes' };
		const chile = { ...NO_FILTERS, country: 'CL' };

		expect(alternativesAt(filters, patagonia).range).toBe(true);
		expect(alternativesAt(chile).range).toBe(true);
	});

	it('offers no range where the scope holds none', () => {
		const bare = [indexEntry('eiger', 'Eiger', { continent: EU })];
		const options = facetedOptions(bare, NO_FILTERS, 'metric', WHOLE_ATLAS);

		expect(filterAlternatives(bare, NO_FILTERS, WHOLE_ATLAS, options).range).toBe(false);
	});

	it('judges country and elevation against what the others leave, not against the catalog', () => {
		const filters = { ...NO_FILTERS, country: 'CL' };

		// Chile holds only Fitz Roy: no band would show fewer, while the country filter, read
		// without its own selection, still has every country to choose between.
		expect(alternativesAt(filters)).toMatchObject({ country: true, elevationBands: false });
	});

	it('keeps choosing among elevation bands while they would show fewer mountains', () => {
		const europe = { kind: 'continent', code: 'EU' } as const;

		expect(alternativesAt(NO_FILTERS, europe).elevationBands).toBe(true);
		expect(alternativesAt(NO_FILTERS, europe).country).toBe(false);
	});
});
