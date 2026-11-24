import { createContext, useContext, useMemo, useState, useSyncExternalStore } from 'react';
import type { MountainIndexEntry } from '../api/contract';
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
	/** What each filter offers given the other two, with the mountains each would leave. */
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
	const filters = useMemo(
		() => settleFilters(mountains, stored.filters, null).filters,
		[mountains, stored.filters]
	);
	const options = useMemo(() => facetedOptions(mountains, filters), [mountains, filters]);
	// Keyed on the filters alone, so a new sort order never rebuilds what the globe draws.
	const matches = useMemo(() => filterMountains(mountains, filters), [mountains, filters]);

	return useMemo(() => {
		const view = { filters, sort: stored.sort };
		const isDefault = isDefaultView(view);

		return {
			options,
			view,
			isDefault,
			matches,
			results: isDefault ? matches : sortMountains(matches, view.sort)
		};
	}, [filters, stored.sort, options, matches]);
}
