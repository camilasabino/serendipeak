import { describe, expect, it, vi } from 'vitest';
import { NO_FILTERS } from './atlasFilter';
import { AtlasViewStore, DEFAULT_ATLAS_VIEW, isDefaultView } from './AtlasViewStore';
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

	it('stops notifying a listener that unsubscribed', () => {
		const store = new AtlasViewStore();
		const listener = vi.fn();
		const unsubscribe = store.subscribe(listener);

		unsubscribe();
		store.setSort('elevation-desc');

		expect(listener).not.toHaveBeenCalled();
	});
});
