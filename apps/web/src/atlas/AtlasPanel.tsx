import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { useMountainIndex } from '../mountain-index/MountainIndexContext';
import {
	ALL_CONTINENTS_LABEL,
	ATLAS_HEADING,
	atlasLede,
	continentsRestoredNotice,
	flatHeading
} from './atlasCopy';
import { activeFilterCount } from './atlasFilter';
import { LIST_HEADING_ID } from './AtlasContext';
import { AtlasControls } from './AtlasControls';
import { AtlasList, continentEntryId, type FlatList } from './AtlasList';
import styles from './AtlasPanel.module.css';
import { useAtlasBrowse, useAtlasViewStore } from './AtlasViewContext';
import { isDefaultView } from './AtlasViewStore';
import { groupByContinent } from './groupByContinent';
import {
	originContinent,
	rangePlace,
	rootRangesByContinent,
	type RangeNavigation
} from './rangeNavigation';
import { useAtlasChoice } from './useAtlasChoice';
import { useHydrated } from './useHydrated';

export const ATLAS_HEADING_ID = 'atlas-heading';

const NO_RANGES: RangeNavigation['byContinent'] = new Map();

/**
 * The atlas sheet: the catalog by continent, beside the globe the layout shows in overview. Once
 * the page is interactive the reader can filter and sort it; the list then becomes one ordered
 * list of matches, and the globe draws the same mountains. The reader can also browse by mountain
 * range, one level at a time: that is the range filter with a way to move up and down the tree of
 * ranges, and the continent they came from remembered so the way back is the way they came. The
 * introduction belongs to the first level alone; every other opens with where the reader is.
 */
export function AtlasPanel({ mountains }: { mountains: MountainIndexEntry[] }) {
	const indexStore = useMountainIndex();
	const groups = useMemo(() => groupByContinent(mountains), [mountains]);
	const viewStore = useAtlasViewStore();
	const browse = useAtlasBrowse(viewStore, mountains);
	const choice = useAtlasChoice(viewStore, mountains, browse.view);
	const interactive = useHydrated();
	const { filters, sort, continent: browsed } = browse.view;
	const { range } = filters;
	const { choose, browseContinent: moveToContinent, say } = choice;
	const [arrivals, setArrivals] = useState(0);
	const returnTo = useRef<string | null>(null);

	useEffect(() => {
		indexStore.seed(mountains);
	}, [indexStore, mountains]);

	// The control that was pressed leaves with the view it changed, so focus is carried to what the
	// reader asked for: the heading of the level they arrived at, or the continent they came back
	// from when they return to all continents. A change made elsewhere, such as the range filter's
	// own popup, keeps the focus that control manages.
	useEffect(() => {
		if (arrivals > 0) {
			const entry = returnTo.current === null ? null : document.getElementById(returnTo.current);
			(entry ?? document.getElementById(LIST_HEADING_ID))?.focus();
		}
	}, [arrivals]);

	// With no range chosen, the matches are what the other filters leave, so the ranges offered
	// and the mountains they lead to agree with them.
	const byContinent = useMemo(
		() => (range === null ? rootRangesByContinent(browse.matches, browse.ranges) : NO_RANGES),
		[range, browse.matches, browse.ranges]
	);
	const place = useMemo(
		() => (range === null ? undefined : rangePlace(browse.ranges, range)),
		[range, browse.ranges]
	);
	const origin = useMemo(
		() => (place === undefined ? undefined : originContinent(browse.matches, browsed)),
		[place, browse.matches, browsed]
	);
	// What the atlas is once no continent or range is browsed, which is where leaving them leads:
	// the filters and sort are kept, so with any on it is the flat list and not the continents.
	const atlasLabel = useMemo(() => {
		const rest = { ...filters, range: null };
		if (isDefaultView({ filters: rest, sort, continent: null })) {
			return ALL_CONTINENTS_LABEL;
		}

		return flatHeading(activeFilterCount(rest) > 0, sort);
	}, [filters, sort]);
	const continent = useMemo<RangeNavigation['continent']>(() => {
		const group = groups.find(({ code }) => code === browsed?.code);
		if (range !== null || browsed === null || group === undefined) {
			return undefined;
		}

		return {
			code: group.code,
			name: group.name,
			showRanges: browsed.ranges,
			ranges: byContinent.get(group.code) ?? [],
			mountains: browse.results.filter((mountain) => mountain.continent.code === group.code)
		};
	}, [range, browsed, groups, byContinent, browse.results]);

	const arrive = useCallback((entry: string | null) => {
		returnTo.current = entry;
		setArrivals((count) => count + 1);
	}, []);
	const browseRange = useCallback(
		(slug: string | null) => {
			choose({ range: slug });
			arrive(null);
		},
		[choose, arrive]
	);
	const browseContinent = useCallback(
		(next: { code: string; ranges: boolean } | null) => {
			moveToContinent(next);
			arrive(next === null && browsed !== null ? continentEntryId(browsed.code) : null);
		},
		[moveToContinent, browsed, arrive]
	);
	const ranges = useMemo<RangeNavigation | undefined>(
		() =>
			interactive
				? {
						byContinent,
						continent,
						place,
						origin,
						atlasLabel,
						choose: browseRange,
						browseContinent
					}
				: undefined,
		[interactive, byContinent, continent, place, origin, atlasLabel, browseRange, browseContinent]
	);

	// Going back to the continents from the flat list is the one move that lets go of the filters,
	// since the continents are the unfiltered catalog; it says so, on the button and once done.
	const filtered = activeFilterCount(filters) > 0;
	const returnToContinents = useCallback(() => {
		viewStore.reset();
		say(continentsRestoredNotice(filtered));
		arrive(null);
	}, [viewStore, say, filtered, arrive]);
	const flat = useMemo<FlatList | undefined>(
		() =>
			browse.isDefault
				? undefined
				: {
						heading: flatHeading(filtered, sort),
						clearsFilters: filtered,
						onReturn: interactive ? returnToContinents : undefined
					},
		[browse.isDefault, filtered, sort, interactive, returnToContinents]
	);

	// The introduction is for a reader who has just arrived; once they navigate or narrow the list
	// the heading shrinks to a label and the level they are on is what the sheet is about.
	const initial = place === undefined && continent === undefined && browse.isDefault;

	return (
		<div className={styles.sheet}>
			<h1
				id={ATLAS_HEADING_ID}
				tabIndex={-1}
				className={initial ? styles.title : `${styles.title} ${styles.titleCompact}`}
			>
				{ATLAS_HEADING}
			</h1>
			{initial && <p className={styles.lede}>{atlasLede(mountains.length)}</p>}
			{groups.length > 0 && (
				<AtlasList
					groups={groups}
					results={browse.isDefault ? undefined : browse.results}
					ranges={ranges}
					flat={flat}
					toolbar={
						interactive && (
							<AtlasControls
								browse={browse}
								store={viewStore}
								mountains={mountains}
								choice={choice}
							/>
						)
					}
				/>
			)}
		</div>
	);
}
