import { describe, expect, it, vi } from 'vitest';
import { NO_FILTERS, WHOLE_ATLAS } from './atlasFilter';
import {
	AtlasViewStore,
	DEFAULT_ATLAS_VIEW,
	isDefaultView,
	scopeOf,
	withFilters
} from './AtlasViewStore';
import { bandSelection } from './elevationBands';

const m = (...floors: number[]) => bandSelection('metric', floors);
const ft = (...floors: number[]) => bandSelection('imperial', floors);

describe('AtlasViewStore', () => {
	it('starts on the default view: no filters, name order', () => {
		const store = new AtlasViewStore();

		expect(store.getSnapshot()).toBe(DEFAULT_ATLAS_VIEW);
		expect(isDefaultView(store.getSnapshot())).toBe(true);
	});

	it('changes one filter at a time and keeps the others, notifying each change once', () => {
		const store = new AtlasViewStore();
		const listener = vi.fn();
		store.subscribe(listener);

		store.setFilters({ country: 'AR' });
		store.setFilters({ range: 'andes' });
		store.setFilters({ elevationBands: m(6000) });

		expect(store.getSnapshot().filters).toEqual({
			country: 'AR',
			range: 'andes',
			elevationBands: m(6000)
		});
		expect(listener).toHaveBeenCalledTimes(3);
	});

	it('treats the same bands as no change, and different bands as one', () => {
		const store = new AtlasViewStore();
		store.setFilters({ elevationBands: m(3000, 4000) });
		const listener = vi.fn();
		store.subscribe(listener);

		store.setFilters({ elevationBands: m(3000, 4000) });
		expect(listener).not.toHaveBeenCalled();

		store.setFilters({ elevationBands: m(3000) });
		expect(listener).toHaveBeenCalledTimes(1);

		store.setFilters({ elevationBands: ft(3000) });
		expect(listener).toHaveBeenCalledTimes(2);

		store.setFilters({ elevationBands: null });
		expect(store.getSnapshot().filters).toEqual(NO_FILTERS);
	});

	it('does not notify for a change that changes nothing', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR' });
		store.setSort('name');
		const before = store.getSnapshot();
		const listener = vi.fn();
		store.subscribe(listener);

		store.setFilters({ country: 'AR' });
		store.setSort('name');

		expect(store.getSnapshot()).toBe(before);
		expect(listener).not.toHaveBeenCalled();
	});

	it('keeps the filters object when only the sort changes', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR' });
		const { filters } = store.getSnapshot();

		store.setSort('elevation-desc');

		expect(store.getSnapshot().filters).toBe(filters);
		expect(store.getSnapshot().sort).toBe('elevation-desc');
		expect(isDefaultView(store.getSnapshot())).toBe(false);
	});

	it('treats a sort alone as a non-default view, and a cleared filter as default again', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR' });
		expect(isDefaultView(store.getSnapshot())).toBe(false);

		store.setFilters({ country: null });

		expect(isDefaultView(store.getSnapshot())).toBe(true);
		expect(store.getSnapshot().filters).toEqual(NO_FILTERS);
	});

	it('resets filters and sort together', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR', range: 'andes' });
		store.setSort('elevation-asc');

		store.reset();

		expect(store.getSnapshot()).toBe(DEFAULT_ATLAS_VIEW);
	});

	describe('browsing a continent', () => {
		const sa = { code: 'SA', ranges: false };
		const saRanges = { code: 'SA', ranges: true };

		it('goes into a continent, to its ranges and back, notifying each change once', () => {
			const store = new AtlasViewStore();
			const listener = vi.fn();
			store.subscribe(listener);

			store.browseContinent(sa);
			store.browseContinent(sa);
			store.browseContinent(saRanges);
			expect(store.getSnapshot().continent).toEqual(saRanges);
			expect(isDefaultView(store.getSnapshot())).toBe(true);

			store.browseContinent(null);
			store.browseContinent(null);
			expect(store.getSnapshot()).toEqual(DEFAULT_ATLAS_VIEW);
			expect(listener).toHaveBeenCalledTimes(3);
		});

		it('keeps the continent while a range is chosen, so the trail can climb back to it', () => {
			const store = new AtlasViewStore();
			store.browseContinent(saRanges);

			store.setFilters({ range: 'andes' });
			store.setFilters({ range: 'patagonian-andes' });
			expect(store.getSnapshot().continent).toEqual(saRanges);

			store.browseContinent(saRanges);
			expect(store.getSnapshot().filters.range).toBeNull();
			expect(store.getSnapshot().continent).toEqual(saRanges);
		});

		it('keeps the other filters when it goes in and when it goes back', () => {
			const store = new AtlasViewStore();
			store.setFilters({ country: 'AR', range: 'andes' });

			store.browseContinent(saRanges);
			expect(store.getSnapshot().filters).toEqual({ ...NO_FILTERS, country: 'AR' });

			store.browseContinent(null);
			expect(store.getSnapshot().filters.country).toBe('AR');
		});

		it('forgets the continent when the range filter is left, but not for another filter', () => {
			const store = new AtlasViewStore();
			store.browseContinent(saRanges);
			store.setFilters({ country: 'AR' });
			expect(store.getSnapshot().continent).toEqual(saRanges);

			store.setFilters({ range: 'andes' });
			store.setFilters({ range: null });

			expect(store.getSnapshot().continent).toBeNull();
		});

		it('takes the filters it is given, already settled, with the range always left', () => {
			const store = new AtlasViewStore();
			store.setFilters({ country: 'NP', range: 'caucasus' });
			const listener = vi.fn();
			store.subscribe(listener);

			store.browseContinent(saRanges, { ...NO_FILTERS, range: 'caucasus' });
			expect(store.getSnapshot().filters).toEqual(NO_FILTERS);
			expect(store.getSnapshot().continent).toEqual(saRanges);

			store.browseContinent(saRanges, NO_FILTERS);
			expect(listener).toHaveBeenCalledTimes(1);
		});

		it('is forgotten by a reset', () => {
			const store = new AtlasViewStore();
			store.browseContinent(sa);
			store.setFilters({ range: 'andes' });

			store.reset();

			expect(store.getSnapshot()).toBe(DEFAULT_ATLAS_VIEW);
		});
	});

	describe('the scope of a view', () => {
		const sa = { code: 'SA', ranges: false };

		it('is the whole atlas, a continent, or the range being browsed wherever it was reached', () => {
			expect(scopeOf(DEFAULT_ATLAS_VIEW)).toBe(WHOLE_ATLAS);
			expect(scopeOf({ ...DEFAULT_ATLAS_VIEW, continent: sa })).toEqual({
				kind: 'continent',
				code: 'SA'
			});
			const range = { ...NO_FILTERS, range: 'andes' };
			expect(scopeOf({ ...DEFAULT_ATLAS_VIEW, filters: range, continent: sa })).toEqual({
				kind: 'range',
				slug: 'andes'
			});
			expect(scopeOf({ ...DEFAULT_ATLAS_VIEW, filters: range })).toEqual({
				kind: 'range',
				slug: 'andes'
			});
		});

		it('goes back to the whole atlas when the range filter is left, not a continent', () => {
			const inRange = {
				...DEFAULT_ATLAS_VIEW,
				filters: { ...NO_FILTERS, range: 'andes' },
				continent: sa
			};

			expect(scopeOf(withFilters(inRange, NO_FILTERS))).toBe(WHOLE_ATLAS);
			expect(withFilters(inRange, { ...NO_FILTERS, range: 'southern-andes' }).continent).toBe(sa);
		});
	});

	it('stops notifying a listener that unsubscribed', () => {
		const store = new AtlasViewStore();
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);

		unsubscribe();
		store.setSort('elevation-desc');

		expect(listener).not.toHaveBeenCalled();
	});

	describe('clearing elevation for a unit change', () => {
		it('drops every selected band and keeps country, range and sort', () => {
			const store = new AtlasViewStore();
			store.setFilters({ country: 'AR', range: 'andes', elevationBands: m(3000, 6000) });
			store.setSort('elevation-desc');

			store.clearElevationForUnits();

			expect(store.getSnapshot().filters).toEqual({
				country: 'AR',
				range: 'andes',
				elevationBands: null
			});
			expect(store.getSnapshot().sort).toBe('elevation-desc');
		});

		it('clears bands chosen in either system, each time they are selected again', () => {
			const store = new AtlasViewStore();

			for (const bands of [ft(9000, 29_000), m(6000), ft(11_000)]) {
				store.setFilters({ elevationBands: bands });
				store.clearElevationForUnits();

				expect(store.getSnapshot().filters.elevationBands).toBeNull();
			}
		});

		it('says so to its listeners once per clear', () => {
			const store = new AtlasViewStore();
			const cleared = vi.fn();
			store.subscribeToUnitClears(cleared);

			store.setFilters({ elevationBands: m(6000) });
			store.clearElevationForUnits();
			store.clearElevationForUnits();

			expect(cleared).toHaveBeenCalledTimes(1);
		});

		it('leaves the view, its object and its listeners alone when no band is selected', () => {
			const store = new AtlasViewStore();
			store.setFilters({ country: 'AR' });
			const stored = store.getSnapshot();
			const changed = vi.fn();
			const cleared = vi.fn();
			store.subscribe(changed);
			store.subscribeToUnitClears(cleared);

			store.clearElevationForUnits();

			expect(store.getSnapshot()).toBe(stored);
			expect(changed).not.toHaveBeenCalled();
			expect(cleared).not.toHaveBeenCalled();
		});

		it('stops telling a listener that unsubscribed', () => {
			const store = new AtlasViewStore();
			const cleared = vi.fn();
			store.subscribeToUnitClears(cleared)();

			store.setFilters({ elevationBands: m(6000) });
			store.clearElevationForUnits();

			expect(cleared).not.toHaveBeenCalled();
		});
	});
});
