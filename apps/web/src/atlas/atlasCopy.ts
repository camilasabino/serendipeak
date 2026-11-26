import { documentTitle, type ErrorContent } from '../mountain-page/pageCopy';
import { elevationUnit, type UnitSystem } from '../units/unitSystem';
import { ELEVATION_BAND_SIZE, type BandSelection } from './elevationBands';

export const ATLAS_LINK_LABEL = 'Atlas';
export const ATLAS_TITLE = documentTitle('3D Mountain Atlas — Explore Peaks');
export const ATLAS_DESCRIPTION =
	'Every mountain on SerendiPeak on an interactive 3D globe: see where each one rises, how high it is, and open its page.';

export const ATLAS_HEADING = 'Atlas';
export const ATLAS_EMPTY = 'There are no mountains on the atlas yet.';

export function atlasLede(count: number): string {
	if (count === 0) {
		return ATLAS_EMPTY;
	}

	return count === 1
		? 'The one mountain on SerendiPeak. Click or tap its point, or choose it below, to open its page.'
		: `Explore ${count.toLocaleString('en')} mountains on the globe. Filter by country, elevation, or mountain range, sort the results, or browse by continent.`;
}

export const ATLAS_LIST_HEADING = 'All mountains';

export function mountainCount(count: number): string {
	return count === 1 ? '1 mountain' : `${count.toLocaleString('en')} mountains`;
}

export const BACK_TO_ATLAS_LABEL = 'Back to atlas';

export const MARKER_CHOOSER_TITLE = 'Which mountain?';
export const CLOSE_MARKER_CHOOSER_LABEL = 'Close the list of mountains';

export const ATLAS_STAGE_LABEL = 'Preparing the atlas...';

export const ATLAS_LOAD_FAILED: ErrorContent = {
	title: "We couldn't load the atlas",
	message: "SerendiPeak couldn't load the atlas right now. Please try again.",
	retryable: true
};

export const FILTER_LABEL = 'Filter';
export const SORT_LABEL = 'Sort';
export const RESET_LABEL = 'Reset';
export const RESET_ACCESSIBLE_LABEL = 'Reset filters and sort';

export const COUNTRY_FILTER_LABEL = 'Country';
export const ANY_COUNTRY_LABEL = 'All countries';
export const ELEVATION_FILTER_LABEL = 'Elevation';
export const ANY_ELEVATION_LABEL = 'Any elevation';
export const RANGE_FILTER_LABEL = 'Mountain range';
export const ANY_RANGE_LABEL = 'All ranges';

export function filterToggleLabel(active: number): string {
	return active === 0 ? FILTER_LABEL : `${FILTER_LABEL}, ${active} active`;
}

export const SORT_OPTION_LABELS = {
	name: 'Name A–Z',
	'elevation-desc': 'Highest first',
	'elevation-asc': 'Lowest first'
} as const;

/** A band as whole numbers with both ends included, though it holds every value up to the next. */
export function elevationBandLabel(floor: number, system: UnitSystem): string {
	const format = (value: number) => value.toLocaleString('en');

	return `${format(floor)}–${format(floor + ELEVATION_BAND_SIZE - 1)} ${elevationUnit(system)}`;
}

export const CLEAR_ELEVATION_LABEL = 'Clear';
export const CLEAR_ELEVATION_ACCESSIBLE_LABEL = 'Clear elevation bands';
export const ELEVATION_BANDS_GROUP_LABEL = 'Elevation bands';

/** What the closed Elevation control shows: nothing chosen, the one band, or how many. */
export function elevationSummary(selection: BandSelection | null): string {
	if (selection === null) {
		return ANY_ELEVATION_LABEL;
	}

	const { system, floors } = selection;

	return floors.length === 1
		? elevationBandLabel(floors[0]!, system)
		: `${floors.length} elevation bands`;
}

/** Said when changing the unit system cleared an active Elevation selection. */
export const ELEVATION_CLEARED_BY_UNITS_NOTICE = 'Elevation filter cleared after changing units.';

export const SEARCH_COUNTRIES_LABEL = 'Search countries';
export const SEARCH_RANGES_LABEL = 'Search mountain ranges';

export function noCountriesMessage(query: string): string {
	return `No countries match \u201c${query}\u201d.`;
}

export function noRangesMessage(query: string): string {
	return `No mountain ranges match \u201c${query}\u201d.`;
}

/** Said, unseen, as a search narrows the list. */
export function choicesFound(count: number): string {
	return count === 1 ? '1 result' : `${count.toLocaleString('en')} results`;
}

const FILTER_NAMES = {
	country: COUNTRY_FILTER_LABEL,
	elevationBands: ELEVATION_FILTER_LABEL,
	range: RANGE_FILTER_LABEL
} as const;

const FILTER_RESET_VALUES = {
	country: ANY_COUNTRY_LABEL,
	elevationBands: ANY_ELEVATION_LABEL,
	range: ANY_RANGE_LABEL
} as const;

/** Said after a choice that left another selection with no mountains. */
export function autoResetNotice(
	reset: readonly (keyof typeof FILTER_NAMES)[],
	removedBands: BandSelection | null = null
): string {
	const sentences: string[] = [];
	if (reset.length > 0) {
		const names = reset.map((key) => `${FILTER_NAMES[key]} (${FILTER_RESET_VALUES[key]})`);
		const list =
			names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0];
		sentences.push(`${list} reset: no mountains matched with your choice.`);
	}
	if (removedBands !== null) {
		const bands = removedBands.floors.map((floor) =>
			elevationBandLabel(floor, removedBands.system)
		);
		const noun = bands.length === 1 ? 'band' : 'bands';
		sentences.push(
			`Elevation ${noun} ${bands.join(', ')} removed: no mountains matched with your choice.`
		);
	}

	return sentences.join(' ');
}

export function resultCount(shown: number, total: number): string {
	if (total === 1) {
		return shown === 1 ? 'Showing the 1 mountain' : 'Showing 0 of 1 mountain';
	}

	return shown === total
		? `Showing all ${total.toLocaleString('en')} mountains`
		: `Showing ${shown.toLocaleString('en')} of ${total.toLocaleString('en')} mountains`;
}

export const NO_MATCHES_TITLE = 'No mountains match these filters.';
export const NO_MATCHES_HINT = 'Try a different combination, or reset to see them all.';
