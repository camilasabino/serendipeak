import type { MountainIndexEntry } from '../api/contract';
import {
	COUNTRY_FILTER_LABEL,
	ELEVATION_FILTER_LABEL,
	RANGE_FILTER_LABEL,
	elevationSummary
} from './atlasCopy';
import {
	filterMountains,
	scopeMountains,
	type AtlasFilters,
	type AtlasOptions,
	type AtlasScope,
	type FilterKey
} from './atlasFilter';

export interface ActiveFilter {
	key: FilterKey;
	/** The filter's own name, which tells chips with similar values apart. */
	filter: string;
	/** What is selected, as the filter's own button shows it. */
	value: string;
}

/**
 * The filters that are on, with the labels their buttons show, in the order the panel lists them.
 * Read from the filters themselves, so a summary never outlives the selection it describes. A
 * selection the options no longer name has nothing to show and is left out.
 */
export function activeFilterSummaries(
	filters: AtlasFilters,
	options: AtlasOptions
): ActiveFilter[] {
	const summaries: ActiveFilter[] = [];

	const country = options.countries.find(({ code }) => code === filters.country);
	if (country) {
		summaries.push({ key: 'country', filter: COUNTRY_FILTER_LABEL, value: country.name });
	}
	if (filters.elevationBands !== null) {
		summaries.push({
			key: 'elevationBands',
			filter: ELEVATION_FILTER_LABEL,
			value: elevationSummary(filters.elevationBands)
		});
	}
	const range = options.ranges.find(({ slug }) => slug === filters.range);
	if (range) {
		summaries.push({ key: 'range', filter: RANGE_FILTER_LABEL, value: range.name });
	}

	return summaries;
}

/**
 * Whether each filter has a choice worth offering. Country and elevation are choices only when
 * one would show fewer mountains than the list shows now, judged against the mountains of the
 * scope that the other filters leave. A range is also a place to go, so any range offered is a
 * choice, whether or not it narrows the list. A filter without one has nothing to choose
 * between. O(n) for n mountains in scope.
 */
export function filterAlternatives(
	mountains: readonly MountainIndexEntry[],
	filters: AtlasFilters,
	scope: AtlasScope,
	options: AtlasOptions
): Record<FilterKey, boolean> {
	const inScope = scopeMountains(mountains, scope);
	const pool = (key: FilterKey) => filterMountains(inScope, { ...filters, [key]: null });
	// Counts were made over these same mountains, so a choice narrows when it holds fewer than all.
	const countries = pool('country').length;
	const bands = pool('elevationBands').length;

	return {
		country: options.countries.some(({ count }) => count < countries),
		elevationBands: options.elevationBands.some(({ count }) => count < bands),
		range: options.ranges.length > 0
	};
}
