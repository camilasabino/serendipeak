import type { MountainIndexEntry } from '../api/contract';
import type { UnitSystem } from '../units/unitSystem';
import { compareByName } from './atlasSort';
import { bandFloorOf, bandSelection, inBands, type BandSelection } from './elevationBands';

/**
 * Country and range pick one value, `null` leaving them off; elevation picks any number of bands
 * in one unit system, `null` leaving it off. A mountain passes when it matches any selected band
 * (OR) and every other active filter (AND).
 */
export interface AtlasFilters {
	/** An ISO country code, matched against every country of a mountain. */
	country: string | null;
	/** The selected bands, always in the displayed unit system: changing units clears them. */
	elevationBands: BandSelection | null;
	/** A region slug, matched against a mountain's region and each of its ancestors. */
	range: string | null;
}

export const NO_FILTERS: AtlasFilters = { country: null, elevationBands: null, range: null };

export interface CountryOption {
	code: string;
	name: string;
	/** Mountains of the catalog it was built from that pass its own predicate. */
	count: number;
}

export interface ElevationOption {
	/** The lower bound of the band, in the unit of the system it was built for. */
	floor: number;
	count: number;
}

export interface RangeOption {
	slug: string;
	name: string;
	/** The slug of the range it sits under; null for a root. */
	parent: string | null;
	/** Ancestors above it, for indenting the option under its parent. */
	depth: number;
	/** The names of those ancestors, root first, for placing a range found out of its tree. */
	ancestors: string[];
	/** Includes the mountains of every subregion, as selecting the range would. */
	count: number;
}

export interface AtlasOptions {
	countries: CountryOption[];
	/** The bands of the displayed system that hold at least one mountain, highest first. */
	elevationBands: ElevationOption[];
	/** Every region a mountain sits in or under, parents before their children. */
	ranges: RangeOption[];
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

function flattenRanges(
	nodes: RangeNode[],
	ancestors: string[],
	parent: string | null
): Omit<RangeOption, 'count'>[] {
	return [...nodes]
		.sort(compareByName)
		.flatMap((node) => [
			{ slug: node.slug, name: node.name, parent, depth: ancestors.length, ancestors },
			...flattenRanges(node.children, [...ancestors, node.name], node.slug)
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

export function elevationOptions(
	mountains: readonly MountainIndexEntry[],
	system: UnitSystem
): ElevationOption[] {
	const floors = new Set(
		mountains.map(({ elevationMeters }) => bandFloorOf(elevationMeters, system))
	);

	return [...floors]
		.sort((a, b) => b - a)
		.map((floor) => ({
			floor,
			count: countMatching(mountains, { elevationBands: bandSelection(system, [floor]) })
		}));
}

export function rangeOptions(mountains: readonly MountainIndexEntry[]): RangeOption[] {
	return flattenRanges(rangeTree(mountains), [], null).map((range) => ({
		...range,
		count: countMatching(mountains, { range: range.slug })
	}));
}

/** What each filter offers for these mountains alone; O(n log n + o·n) for n mountains, o options. */
export function atlasOptions(
	mountains: readonly MountainIndexEntry[],
	system: UnitSystem
): AtlasOptions {
	return {
		countries: countryOptions(mountains),
		elevationBands: elevationOptions(mountains, system),
		ranges: rangeOptions(mountains)
	};
}

/**
 * The part of the catalog the reader has navigated to, which bounds what the filters offer: the
 * whole atlas, one continent, or one range with its subranges.
 */
export type AtlasScope =
	{ kind: 'atlas' } | { kind: 'continent'; code: string } | { kind: 'range'; slug: string };

export const WHOLE_ATLAS: AtlasScope = { kind: 'atlas' };

export function inScope(mountain: MountainIndexEntry, scope: AtlasScope): boolean {
	switch (scope.kind) {
		case 'atlas':
			return true;
		case 'continent':
			return mountain.continent.code === scope.code;
		case 'range':
			return inRange(mountain, scope.slug);
	}
}

/** The mountains within a scope, in the order given; the same array for the whole atlas. */
export function scopeMountains(
	mountains: readonly MountainIndexEntry[],
	scope: AtlasScope
): readonly MountainIndexEntry[] {
	return scope.kind === 'atlas' ? mountains : mountains.filter((m) => inScope(m, scope));
}

/**
 * The range options the other filters leave across the whole catalog: the tree the reader browses,
 * whose trail and subranges reach beyond any scope.
 */
export function facetedRanges(
	mountains: readonly MountainIndexEntry[],
	filters: AtlasFilters
): RangeOption[] {
	return rangeOptions(filterMountains(mountains, { ...filters, range: null }));
}

/**
 * The ranges of the tree that some of these mountains sit in or under, kept within the scope: for
 * a range, only it and its descendants, re-indented so it is the top of the tree. Each keeps its
 * count, which is what choosing it leaves, and its ancestors, which still place it. O(n·d + r).
 */
function rangesWithin(
	tree: RangeOption[],
	mountains: readonly MountainIndexEntry[],
	scope: AtlasScope
): RangeOption[] {
	if (scope.kind === 'atlas') {
		return tree;
	}

	const offered = new Set<string>();
	for (const { region } of mountains) {
		if (region === null) {
			continue;
		}
		const chain = [...region.ancestors, region];
		const top = scope.kind === 'range' ? chain.findIndex(({ slug }) => slug === scope.slug) : 0;
		if (top === -1) {
			continue;
		}
		for (const { slug } of chain.slice(top)) {
			offered.add(slug);
		}
	}

	const shift = scope.kind === 'range' ? (tree.find((o) => o.slug === scope.slug)?.depth ?? 0) : 0;

	return tree
		.filter(({ slug }) => offered.has(slug))
		.map((option) => (shift === 0 ? option : { ...option, depth: option.depth - shift }));
}

/**
 * What each filter offers given the others, within the scope the reader has navigated to: its
 * options come from the mountains in scope that pass every active filter except its own, so
 * choosing any offered option leaves at least one mountain, in whatever order the filters were
 * chosen, and nothing outside the scope is offered. Country and elevation count the mountains in
 * scope; a range counts every mountain it holds, since choosing it browses the whole range. A few
 * filtering passes and the option lists; with fewer than a hundred mountains, a few thousand
 * predicate calls.
 */
export function facetedOptions(
	mountains: readonly MountainIndexEntry[],
	filters: AtlasFilters,
	system: UnitSystem,
	scope: AtlasScope = WHOLE_ATLAS
): AtlasOptions {
	const scoped = scopeMountains(mountains, scope);
	const without = (key: FilterKey) => filterMountains(scoped, { ...filters, [key]: null });

	return {
		countries: countryOptions(without('country')),
		elevationBands: elevationOptions(without('elevationBands'), system),
		ranges: rangesWithin(facetedRanges(mountains, filters), without('range'), scope)
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
		(elevationBands === null || inBands(mountain.elevationMeters, elevationBands)) &&
		(range === null || inRange(mountain, range))
	);
}

/** How many of the three filters are on; elevation counts once however many bands it holds. */
export function activeFilterCount({ country, elevationBands, range }: AtlasFilters): number {
	return [country !== null, elevationBands !== null, range !== null].filter(Boolean).length;
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
	removedBands: BandSelection | null;
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
		if (value === null) {
			continue;
		}
		const candidate = { ...kept, [key]: value };
		if (filterMountains(mountains, candidate).length > 0) {
			kept = candidate;
		} else {
			reset.push(key);
		}
	}

	const bands = kept.elevationBands;
	const holds = (floor: number) =>
		bands !== null &&
		filterMountains(mountains, { ...kept, elevationBands: bandSelection(bands.system, [floor]) })
			.length > 0;
	const valid = bands && bandSelection(bands.system, bands.floors.filter(holds));
	const removedBands =
		bands &&
		bandSelection(
			bands.system,
			bands.floors.filter((floor) => !holds(floor))
		);
	if (reset.length === 0 && removedBands === null) {
		return { filters, reset, removedBands };
	}

	return { filters: { ...kept, elevationBands: valid }, reset, removedBands };
}

/**
 * Settles the selections within the scope the reader is in. A continent bounds the mountains they
 * are judged against, so no selection is left that the continent cannot show; a range scope is the
 * range filter itself, settled with the rest over the whole catalog.
 */
export function settleInScope(
	mountains: readonly MountainIndexEntry[],
	filters: AtlasFilters,
	scope: AtlasScope,
	priority: FilterKey | null
): SettledFilters {
	const pool = scope.kind === 'continent' ? scopeMountains(mountains, scope) : mountains;

	return settleFilters(pool, filters, priority);
}
