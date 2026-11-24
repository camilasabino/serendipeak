import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { useUnitSystem } from '../units/UnitPreferenceContext';
import { facetedOptions, filterMountains, settleFilters, type AtlasOptions } from './atlasFilter';
import { sortMountains } from './atlasSort';
import { AtlasViewStore, isDefaultView, type AtlasView } from './AtlasViewStore';

const AtlasViewContext = createContext<AtlasViewStore | undefined>(undefined);

/** The reader's atlas view. The stage layout holds it, so it survives a visit to a mountain page. */
export const AtlasViewProvider = AtlasViewContext.Provider;

export function useAtlasViewStore(): AtlasViewStore {
	const shared = useContext(AtlasViewContext);
	const [own] = useState(() => new AtlasViewStore());

	return shared ?? own;
}

export interface AtlasBrowse {
	/** What each filter offers given the other two, in the displayed unit, with what each leaves. */
	options: AtlasOptions;
	/** The view in force: a selection the catalog no longer offers is already dropped. */
	view: AtlasView;
	isDefault: boolean;
	/** The mountains that pass the filters, in catalog order: what the globe draws. */
	matches: readonly MountainIndexEntry[];
	/** The matches in the order the list shows them. */
	results: readonly MountainIndexEntry[];
}

/**
 * The catalog as the reader's view shows it. The list and the globe both read it, each from its
 * own call, so they always agree: the same pure derivation of the same store and catalog. O(n log
 * n) for n mountains whenever the catalog or the view changes.
 */
export function useAtlasBrowse(
	store: AtlasViewStore,
	mountains: readonly MountainIndexEntry[]
): AtlasBrowse {
	const stored = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
	const system = useUnitSystem();
	const filters = useMemo(
		() => settleFilters(mountains, stored.filters, null).filters,
		[mountains, stored.filters]
	);
	// Only the options read the displayed unit; the filters, matches and results never do.
	const options = useMemo(
		() => facetedOptions(mountains, filters, system),
		[mountains, filters, system]
	);
	// Keyed on the filters alone, so a new sort order never rebuilds what the globe draws.
	const matches = useMemo(() => filterMountains(mountains, filters), [mountains, filters]);
	const view = useMemo(() => ({ filters, sort: stored.sort }), [filters, stored.sort]);
	const results = useMemo(
		() => (isDefaultView(view) ? matches : sortMountains(matches, view.sort)),
		[view, matches]
	);

	return useMemo(
		() => ({ options, view, isDefault: isDefaultView(view), matches, results }),
		[options, view, matches, results]
	);
}
