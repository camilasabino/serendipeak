import { useCallback, useState } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { autoResetNotice } from './atlasCopy';
import { settleInScope, type AtlasFilters } from './atlasFilter';
import {
	scopeOf,
	withFilters,
	type AtlasView,
	type AtlasViewStore,
	type ContinentBrowse
} from './AtlasViewStore';

/** How a reader's choice reaches the atlas view, and what the atlas says about it. */
export interface AtlasChoice {
	/**
	 * Said, with the count, in the live region, so a choice and what it undid are one announcement.
	 * Empty when there is nothing to add.
	 */
	notice: string;
	/** A choice is always kept; only the selections it leaves without mountains go back to "all". */
	choose(change: Partial<AtlasFilters>): void;
	/**
	 * Goes into a continent, or with `null` back to all continents, keeping every selection that
	 * still has mountains there; the others go back to "all".
	 */
	browseContinent(next: ContinentBrowse | null): void;
	say(notice: string): void;
}

/**
 * The one way the atlas applies a filter choice or a move between continents, whichever control
 * makes it: the filter popups, the continents, the ranges listed under a continent and the trail
 * of the range being browsed. Selections are settled within where the reader ends up, so none is
 * left that the list there cannot show.
 */
export function useAtlasChoice(
	store: AtlasViewStore,
	mountains: readonly MountainIndexEntry[],
	view: AtlasView
): AtlasChoice {
	const [notice, say] = useState('');

	const choose = useCallback(
		(change: Partial<AtlasFilters>) => {
			const [key] = Object.keys(change) as (keyof AtlasFilters)[];
			const next = withFilters(view, { ...view.filters, ...change });
			const settled = settleInScope(mountains, next.filters, scopeOf(next), key!);
			store.setFilters(settled.filters);
			say(autoResetNotice(settled.reset, settled.removedBands));
		},
		[store, mountains, view]
	);

	const browseContinent = useCallback(
		(continent: ContinentBrowse | null) => {
			const filters = { ...view.filters, range: null };
			const scope = scopeOf({ ...view, filters, continent });
			const settled = settleInScope(mountains, filters, scope, null);
			store.browseContinent(continent, settled.filters);
			say(autoResetNotice(settled.reset, settled.removedBands));
		},
		[store, mountains, view]
	);

	return { notice, choose, browseContinent, say };
}
