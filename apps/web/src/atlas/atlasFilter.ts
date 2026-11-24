import type { MountainIndexEntry } from '../api/contract';
import { compareByName } from './atlasSort';

/**
 * Country and range pick one value, `null` leaving them off; elevation picks any number of bands,
 * none leaving it off. A mountain passes when it matches any selected band (OR) and every other
 * active filter (AND).
 */
export interface AtlasFilters {
	/** An ISO country code, matched against every country of a mountain. */
	country: string | null;
	/** The lower bounds of the selected 1,000 m bands, in metres, ascending and without repeats. */
	elevationBands: readonly number[];
	/** A region slug, matched against a mountain's region and each of its ancestors. */
	range: string | null;
}

export const NO_FILTERS: AtlasFilters = { country: null, elevationBands: [], range: null };

export const ELEVATION_BAND_METERS = 1000;

export interface CountryOption {
	code: string;
	name: string;
	/** Mountains of the catalog it was built from that pass its own predicate. */
	count: number;
}

export interface ElevationOption {
	/** The lower bound of the band, in metres. */
	floor: number;
	count: number;
}

export interface RangeOption {
	slug: string;
	name: string;
	/** Ancestors above it, for indenting the option under its parent. */
	depth: number;
	/** The names of those ancestors, root first, for placing a range found out of its tree. */
	ancestors: string[];
	/** Includes the mountains of every subregion, as selecting the range would. */
	count: number;
}

export interface AtlasOptions {
	countries: CountryOption[];
	/** The bands that hold at least one mountain, highest first. */
	elevationBands: ElevationOption[];
	/** Every region a mountain sits in or under, parents before their children. */
	ranges: RangeOption[];
}

export function elevationBandOf(elevationMeters: number): number {
	return Math.floor(elevationMeters / ELEVATION_BAND_METERS) * ELEVATION_BAND_METERS;
}

interface RangeNode {
	slug: string;
	name: string;
	parent: string | null;
	children: RangeNode[];
}

function rangeTree(mountains: readonly MountainIndexEntry[]): RangeNode[] {
	const nodes = new Map<string, RangeNode>();
	for (const { region } of mountains) {
		if (region === null) {
			continue;
		}
		// Ancestors run from the root down, so each link in the chain names its parent.
		const chain = [...region.ancestors, region];
		chain.forEach(({ slug, name }, index) => {
			if (!nodes.has(slug)) {
				nodes.set(slug, { slug, name, parent: chain[index - 1]?.slug ?? null, children: [] });
			}
		});
	}

	const roots: RangeNode[] = [];
	for (const node of nodes.values()) {
		const parent = node.parent === null ? undefined : nodes.get(node.parent);
		(parent?.children ?? roots).push(node);
	}

	return roots;
}

function flattenRanges(nodes: RangeNode[], ancestors: string[]): Omit<RangeOption, 'count'>[] {
	return [...nodes]
		.sort(compareByName)
		.flatMap((node) => [
			{ slug: node.slug, name: node.name, depth: ancestors.length, ancestors },
			...flattenRanges(node.children, [...ancestors, node.name])
		]);
}

// Counts go through the same predicate that filtering uses, so an option's number is exactly what
// choosing it would leave.
function countMatching(
	mountains: readonly MountainIndexEntry[],
	only: Partial<AtlasFilters>
): number {
	const filters = { ...NO_FILTERS, ...only };

	return mountains.filter((mountain) => matchesFilters(mountain, filters)).length;
}

export function countryOptions(mountains: readonly MountainIndexEntry[]): CountryOption[] {
	const names = new Map<string, string>();
	for (const { countries } of mountains) {
		for (const { code, name } of countries) {
			if (!names.has(code)) {
				names.set(code, name);
			}
		}
	}

	return [...names]
		.map(([code, name]) => ({ code, name, count: countMatching(mountains, { country: code }) }))
		.sort((a, b) => compareByName(a, b) || (a.code < b.code ? -1 : 1));
}

export function elevationOptions(mountains: readonly MountainIndexEntry[]): ElevationOption[] {
	const floors = new Set(mountains.map(({ elevationMeters }) => elevationBandOf(elevationMeters)));

	return [...floors]
		.sort((a, b) => b - a)
		.map((floor) => ({ floor, count: countMatching(mountains, { elevationBands: [floor] }) }));
}

export function rangeOptions(mountains: readonly MountainIndexEntry[]): RangeOption[] {
	return flattenRanges(rangeTree(mountains), []).map((range) => ({
		...range,
		count: countMatching(mountains, { range: range.slug })
	}));
}

/** What each filter offers for these mountains alone; O(n log n + o·n) for n mountains, o options. */
export function atlasOptions(mountains: readonly MountainIndexEntry[]): AtlasOptions {
	return {
		countries: countryOptions(mountains),
		elevationBands: elevationOptions(mountains),
		ranges: rangeOptions(mountains)
	};
}

/**
 * What each filter offers given the others: its options come from the mountains that pass every
 * active filter except its own, so choosing any offered option leaves at least one mountain, in
 * whatever order the filters were chosen. Three filtering passes and the option lists; with fewer
 * than a hundred mountains, a few thousand predicate calls.
 */
export function facetedOptions(
	mountains: readonly MountainIndexEntry[],
	filters: AtlasFilters
): AtlasOptions {
	return {
		countries: countryOptions(filterMountains(mountains, { ...filters, country: null })),
		elevationBands: elevationOptions(
			filterMountains(mountains, { ...filters, elevationBands: [] })
		),
		ranges: rangeOptions(filterMountains(mountains, { ...filters, range: null }))
	};
}

export function inRange(mountain: MountainIndexEntry, slug: string): boolean {
	const { region } = mountain;

	return region !== null && (region.slug === slug || region.ancestors.some((a) => a.slug === slug));
}

export function matchesFilters(mountain: MountainIndexEntry, filters: AtlasFilters): boolean {
	const { country, elevationBands, range } = filters;

	return (
		(country === null || mountain.countries.some(({ code }) => code === country)) &&
		(elevationBands.length === 0 ||
			elevationBands.includes(elevationBandOf(mountain.elevationMeters))) &&
		(range === null || inRange(mountain, range))
	);
}

/** How many of the three filters are on; elevation counts once however many bands it holds. */
export function activeFilterCount({ country, elevationBands, range }: AtlasFilters): number {
	return [country !== null, elevationBands.length > 0, range !== null].filter(Boolean).length;
}

/** Bands in the one form the filter keeps them in: ascending, each once. */
export function normalizeBands(bands: readonly number[]): number[] {
	return [...new Set(bands)].sort((a, b) => a - b);
}

export function sameBands(a: readonly number[], b: readonly number[]): boolean {
	return a.length === b.length && a.every((band, index) => band === b[index]);
}

/** The mountains that pass every active filter, in the order given; the same array when none is on. */
export function filterMountains(
	mountains: readonly MountainIndexEntry[],
	filters: AtlasFilters
): readonly MountainIndexEntry[] {
	if (activeFilterCount(filters) === 0) {
		return mountains;
	}

	return mountains.filter((mountain) => matchesFilters(mountain, filters));
}

export type FilterKey = keyof AtlasFilters;

const FILTER_ORDER: readonly FilterKey[] = ['country', 'elevationBands', 'range'];

export interface SettledFilters {
	filters: AtlasFilters;
	/** The selections that had to go back to "all", in the order they were let go. */
	reset: FilterKey[];
	/** Selected bands let go while others stayed; elevation is not in `reset` then. */
	removedBands: number[];
}

/**
 * Makes a set of selections consistent: every one is kept unless keeping it would leave no
 * mountain, in which case it returns to "all". The selection the reader just made (`priority`)
 * is considered first and so is never the one dropped; the rest follow in a fixed order, so the
 * outcome is the same whichever way the state was reached and settling twice changes nothing.
 * Elevation is judged as a whole, then each of its bands must still hold a mountain under the
 * country and range that remain, and only the bands that do not are removed. This also drops a
 * selection the catalog no longer holds. The same object when nothing changes.
 */
export function settleFilters(
	mountains: readonly MountainIndexEntry[],
	filters: AtlasFilters,
	priority: FilterKey | null
): SettledFilters {
	const order =
		priority === null ? FILTER_ORDER : [priority, ...FILTER_ORDER.filter((k) => k !== priority)];
	let kept: AtlasFilters = NO_FILTERS;
	const reset: FilterKey[] = [];
	for (const key of order) {
		const value = filters[key];
		if (value === null || (Array.isArray(value) && value.length === 0)) {
			continue;
		}
		const candidate = { ...kept, [key]: value };
		if (filterMountains(mountains, candidate).length > 0) {
			kept = candidate;
		} else {
			reset.push(key);
		}
	}

	const bands = normalizeBands(kept.elevationBands);
	const valid = bands.filter(
		(band) => filterMountains(mountains, { ...kept, elevationBands: [band] }).length > 0
	);
	const removedBands = bands.filter((band) => !valid.includes(band));
	const settled = { ...kept, elevationBands: valid };
	const unchanged =
		reset.length === 0 && removedBands.length === 0 && sameBands(filters.elevationBands, valid);

	return unchanged ? { filters, reset, removedBands } : { filters: settled, reset, removedBands };
}
