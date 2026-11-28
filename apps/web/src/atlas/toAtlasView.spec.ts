import { describe, expect, it } from 'vitest';
import type { MountainIndexEntry } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import { ATLAS_VIEW, sameAtlasFocus, sameAtlasView } from '../stage/globe/atlasView';
import { NO_FILTERS, type AtlasFilters } from './atlasFilter';
import { AtlasViewStore, DEFAULT_ATLAS_VIEW, type AtlasView } from './AtlasViewStore';
import { bandSelection } from './elevationBands';
import { toAtlasView } from './toAtlasView';

const SOUTH_AMERICA = { code: 'SA', name: 'South America' };
const ASIA = { code: 'AS', name: 'Asia' };

const ACONCAGUA = indexEntry('aconcagua', 'Aconcagua', {
	continent: SOUTH_AMERICA,
	coordinates: { latitude: -32.653, longitude: -70.011 },
	elevationMeters: 6961
});
const FITZ_ROY = indexEntry('fitz-roy', 'Fitz Roy', {
	continent: SOUTH_AMERICA,
	coordinates: { latitude: -49.271, longitude: -73.043 },
	elevationMeters: 3405
});
const EVEREST = indexEntry('everest', 'Mount Everest', {
	continent: ASIA,
	coordinates: { latitude: 27.988, longitude: 86.925 },
	elevationMeters: 8849
});
const CATALOG = [ACONCAGUA, FITZ_ROY, EVEREST];

const ACONCAGUA_AT = { latitude: -32.653, longitude: -70.011 };
const FITZ_ROY_AT = { latitude: -49.271, longitude: -73.043 };

function view(filters: AtlasFilters, continent: AtlasView['continent'] = null): AtlasView {
	return { ...DEFAULT_ATLAS_VIEW, filters, continent };
}

describe('toAtlasView', () => {
	it('keeps the overview when no filter is on, so the camera has nothing to answer', () => {
		expect(toAtlasView(view(NO_FILTERS), CATALOG, CATALOG)).toBe(ATLAS_VIEW);
	});

	it.each(['metric', 'imperial'] as const)(
		'keeps the overview for %s elevation bands alone, which say nothing about where to look',
		(system) => {
			const filters = { ...NO_FILTERS, elevationBands: bandSelection(system, [6000]) };

			expect(toAtlasView(view(filters), CATALOG, [ACONCAGUA, EVEREST])).toBe(ATLAS_VIEW);
		}
	);

	it.each([
		['a country', { ...NO_FILTERS, country: 'AR' }],
		['a range', { ...NO_FILTERS, range: 'andes' }],
		['a country and a range', { ...NO_FILTERS, country: 'AR', range: 'andes' }],
		[
			'a country, a range and a band',
			{ country: 'AR', range: 'andes', elevationBands: bandSelection('metric', [3000]) }
		]
	])('frames the coordinates of the matches for %s', (_name, filters) => {
		const framed = toAtlasView(view(filters), CATALOG, [ACONCAGUA, FITZ_ROY]);

		expect(framed.center).toBe(ATLAS_VIEW.center);
		expect(framed.focus).toEqual([ACONCAGUA_AT, FITZ_ROY_AT]);
	});

	it('follows the matches when an elevation band narrows a geographic filter', () => {
		const filters = { country: 'AR', range: null, elevationBands: bandSelection('metric', [6000]) };

		expect(toAtlasView(view(filters), CATALOG, [ACONCAGUA]).focus).toEqual([ACONCAGUA_AT]);
	});

	it('keeps the overview when nothing matches, rather than framing nowhere', () => {
		expect(toAtlasView(view({ ...NO_FILTERS, country: 'AR' }), CATALOG, [])).toBe(ATLAS_VIEW);
	});
});

describe('toAtlasView for a continent', () => {
	const southAmerica = { code: 'SA', ranges: false };

	it('frames every mountain of the continent the reader went into, and none of another', () => {
		const framed = toAtlasView(view(NO_FILTERS, southAmerica), CATALOG, CATALOG);

		expect(framed.center).toBe(ATLAS_VIEW.center);
		expect(framed.focus).toEqual([ACONCAGUA_AT, FITZ_ROY_AT]);
	});

	it('is the same framing for its mountains and for its ranges', () => {
		const mountains = toAtlasView(view(NO_FILTERS, southAmerica), CATALOG, CATALOG);
		const ranges = toAtlasView(
			view(NO_FILTERS, { ...southAmerica, ranges: true }),
			CATALOG,
			CATALOG
		);

		expect(sameAtlasView(mountains, ranges)).toBe(true);
	});

	it('does not move with elevation, which the continent’s own mountains ignore', () => {
		const filters = { ...NO_FILTERS, elevationBands: bandSelection('metric', [6000]) };
		const banded = toAtlasView(view(filters, southAmerica), CATALOG, [ACONCAGUA]);
		const plain = toAtlasView(view(NO_FILTERS, southAmerica), CATALOG, CATALOG);

		expect(sameAtlasView(banded, plain)).toBe(true);
	});

	it.each([
		['a country', { ...NO_FILTERS, country: 'AR' }, [ACONCAGUA_AT, FITZ_ROY_AT]],
		['a range', { ...NO_FILTERS, range: 'andes' }, [FITZ_ROY_AT]]
	])('yields to the more specific %s, framing what the filters leave', (_name, filters, at) => {
		const matches = at.length === 1 ? [FITZ_ROY] : [ACONCAGUA, FITZ_ROY];

		expect(toAtlasView(view(filters, southAmerica), CATALOG, matches).focus).toEqual(at);
	});

	it('returns to the continent when the country or range is left', () => {
		const country = toAtlasView(view({ ...NO_FILTERS, country: 'AR' }, southAmerica), CATALOG, [
			ACONCAGUA
		]);
		const left = toAtlasView(view(NO_FILTERS, southAmerica), CATALOG, CATALOG);

		expect(sameAtlasFocus(country.focus, left.focus)).toBe(false);
		expect(left.focus).toEqual([ACONCAGUA_AT, FITZ_ROY_AT]);
	});

	it('frames the continent rather than nowhere when a geographic filter leaves nothing', () => {
		const filters = { ...NO_FILTERS, country: 'AR' };

		expect(toAtlasView(view(filters, southAmerica), CATALOG, []).focus).toEqual([
			ACONCAGUA_AT,
			FITZ_ROY_AT
		]);
	});

	it('keeps the overview for a continent the catalog has no mountains on', () => {
		expect(toAtlasView(view(NO_FILTERS, { code: 'AF', ranges: false }), CATALOG, CATALOG)).toBe(
			ATLAS_VIEW
		);
	});

	it('is the overview again for all continents', () => {
		expect(toAtlasView(view(NO_FILTERS, null), CATALOG, CATALOG)).toBe(ATLAS_VIEW);
	});
});

describe('the camera focus along the reader’s navigation', () => {
	const andes = { slug: 'andes', name: 'Andes' };
	const catalog: MountainIndexEntry[] = [
		{
			...ACONCAGUA,
			region: { slug: 'principal-cordillera', name: 'Principal', ancestors: [andes] }
		},
		{ ...FITZ_ROY, region: { slug: 'patagonian-andes', name: 'Patagonian', ancestors: [andes] } },
		EVEREST
	];

	function framing(store: AtlasViewStore) {
		const { filters, continent } = store.getSnapshot();
		const matches = catalog.filter(
			(mountain) =>
				filters.range === null ||
				mountain.region?.slug === filters.range ||
				mountain.region?.ancestors.some(({ slug }) => slug === filters.range)
		);

		return toAtlasView({ filters, continent }, catalog, matches);
	}

	it('flies only when the effective focus changes', () => {
		const store = new AtlasViewStore();
		const log: boolean[] = [];
		let previous = framing(store);
		const step = (move: () => void) => {
			move();
			const next = framing(store);
			log.push(!sameAtlasFocus(previous.focus, next.focus));
			previous = next;
		};

		step(() => store.browseContinent({ code: 'SA', ranges: false })); // all → continent
		step(() => store.browseContinent({ code: 'SA', ranges: true })); // mountains → ranges
		step(() => store.browseContinent({ code: 'SA', ranges: false })); // ranges → mountains
		step(() => store.setSort('elevation-desc'));
		step(() => store.setFilters({ elevationBands: bandSelection('metric', [6000]) }));
		step(() => store.setFilters({ elevationBands: null }));
		step(() => store.setFilters({ range: 'andes' })); // a range that holds the whole continent
		step(() => store.setFilters({ range: 'patagonian-andes' })); // narrower
		step(() => store.browseContinent({ code: 'SA', ranges: true })); // back to the continent
		step(() => store.browseContinent(null)); // all continents
		step(() => store.browseContinent({ code: 'SA', ranges: false }));
		step(() => store.reset());

		expect(log).toEqual([
			true,
			false,
			false,
			false,
			false,
			false,
			false,
			true,
			true,
			true,
			true,
			true
		]);
		expect(previous).toBe(ATLAS_VIEW);
	});

	it('frames the continent again, exactly as before, on the way back up from a range', () => {
		const store = new AtlasViewStore();
		store.browseContinent({ code: 'SA', ranges: true });
		const continent = framing(store);
		store.setFilters({ range: 'patagonian-andes' });
		expect(sameAtlasView(framing(store), continent)).toBe(false);
		store.browseContinent({ code: 'SA', ranges: true });

		expect(sameAtlasView(framing(store), continent)).toBe(true);
	});
});
