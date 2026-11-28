import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { useUnitSystem } from '../units/UnitPreferenceContext';
import {
	facetedOptions,
	facetedRanges,
	filterMountains,
	settleInScope,
	type AtlasOptions,
	type RangeOption
} from './atlasFilter';
import { sortMountains } from './atlasSort';
import { AtlasViewStore, isDefaultView, scopeOf, type AtlasView } from './AtlasViewStore';

const AtlasViewContext = createContext<AtlasViewStore | undefined>(undefined);

/** The reader's atlas view. The stage layout holds it, so it survives a visit to a mountain page. */
export const AtlasViewProvider = AtlasViewContext.Provider;

export function useAtlasViewStore(): AtlasViewStore {
	const shared = useContext(AtlasViewContext);
	const [own] = useState(() => new AtlasViewStore());

	return shared ?? own;
}

export interface AtlasBrowse {
	/**
	 * What each filter offers given the other two, within the continent or range the reader is in,
	 * in the displayed unit, with what each leaves.
	 */
	options: AtlasOptions;
	/** The ranges the other filters leave across the whole catalog: the tree the reader browses. */
	ranges: RangeOption[];
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
	const { filters: chosen, continent } = stored;
	const filters = useMemo(
		() => settleInScope(mountains, chosen, scopeOf({ filters: chosen, continent }), null).filters,
		[mountains, chosen, continent]
	);
	const view = useMemo(
		() => ({ filters, sort: stored.sort, continent }),
		[filters, stored.sort, continent]
	);
	// Navigation sets the scope and the filters narrow within it; neither reads the results, so the
	// options never depend on what they produce. Only the options read the displayed unit.
	const scope = useMemo(() => scopeOf({ filters, continent }), [filters, continent]);
	const options = useMemo(
		() => facetedOptions(mountains, filters, system, scope),
		[mountains, filters, system, scope]
	);
	const ranges = useMemo(() => facetedRanges(mountains, filters), [mountains, filters]);
	// Keyed on the filters alone, so a new sort order never rebuilds what the globe draws.
	const matches = useMemo(() => filterMountains(mountains, filters), [mountains, filters]);
	const results = useMemo(
		() => (isDefaultView(view) ? matches : sortMountains(matches, view.sort)),
		[view, matches]
	);

	return useMemo(
		() => ({ options, ranges, view, isDefault: isDefaultView(view), matches, results }),
		[options, ranges, view, matches, results]
	);
}
