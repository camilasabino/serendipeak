import type { MountainIndexEntry } from '../api/contract';
import type { RangeOption } from './atlasFilter';
import { compareByName } from './atlasSort';
import type { ContinentBrowse } from './AtlasViewStore';

export interface RangeCrumb {
	slug: string;
	name: string;
}

/** Where the reader stands in the range tree: the way down to it, itself, and what lies directly below. */
export interface RangePlace {
	/** From the topmost range to this one, which is last. */
	trail: RangeCrumb[];
	range: RangeOption;
	/** The ranges directly below it, by name; none for a range with no subranges. */
	subranges: RangeOption[];
}

/**
 * The place of one range among the options the atlas offers, which hold parents before children.
 * Undefined for a slug they do not offer. O(r) for r options.
 */
export function rangePlace(ranges: readonly RangeOption[], slug: string): RangePlace | undefined {
	const bySlug = new Map(ranges.map((option) => [option.slug, option]));
	const range = bySlug.get(slug);
	if (range === undefined) {
		return undefined;
	}

	const trail: RangeCrumb[] = [];
	for (
		let at: RangeOption | undefined = range;
		at !== undefined;
		at = bySlug.get(at.parent ?? '')
	) {
		trail.unshift({ slug: at.slug, name: at.name });
	}

	return { trail, range, subranges: ranges.filter((option) => option.parent === slug) };
}

/**
 * The topmost ranges of each continent, by continent code, in the order the options give. A range
 * belongs to every continent that holds one of its mountains, subranges included, so one that
 * crosses continents is listed in each; its count is always what choosing it would leave.
 * O(n·d + r·c) for n mountains of depth d, r options and c continents.
 */
export function rootRangesByContinent(
	mountains: readonly MountainIndexEntry[],
	ranges: readonly RangeOption[]
): Map<string, RangeOption[]> {
	const continentsOf = new Map<string, Set<string>>();
	for (const { region, continent } of mountains) {
		if (region === null) {
			continue;
		}
		const root = (region.ancestors[0] ?? region).slug;
		const codes = continentsOf.get(root) ?? new Set<string>();
		codes.add(continent.code);
		continentsOf.set(root, codes);
	}

	const byContinent = new Map<string, RangeOption[]>();
	for (const option of ranges) {
		if (option.parent !== null) {
			continue;
		}
		for (const code of continentsOf.get(option.slug) ?? []) {
			byContinent.set(code, [...(byContinent.get(code) ?? []), option]);
		}
	}

	return byContinent;
}

/**
 * The subrange of the selected range that a mountain sits in or under, or undefined when it sits
 * in the selected range itself or in none of its descendants.
 */
export function subrangeOf(mountain: MountainIndexEntry, selected: string): string | undefined {
	const { region } = mountain;
	if (region === null || region.slug === selected) {
		return undefined;
	}

	const chain = [...region.ancestors, region];
	const at = chain.findIndex(({ slug }) => slug === selected);

	return at === -1 ? undefined : chain[at + 1]?.name;
}

/** The names of the continents the mountains lie on, alphabetically. */
export function continentNames(mountains: readonly MountainIndexEntry[]): string[] {
	const names = new Set(mountains.map(({ continent }) => continent.name));

	return [...names]
		.map((name) => ({ name }))
		.sort(compareByName)
		.map(({ name }) => name);
}

export interface RangeContinent {
	code: string;
	name: string;
}

/** The continent a range was reached through, and the level of it the reader came from. */
export interface RangeOrigin extends RangeContinent {
	/** Their way in was the continent's mountain ranges, not its mountains. */
	ranges: boolean;
}

/**
 * Where the way up from a range leads first: the level of the continent the reader browsed before
 * the range, remembered by the view. Undefined when no continent was browsed, as when the range
 * was chosen from the filter alone, and also when the continent holds none of the range's
 * mountains, so the way up starts at the atlas rather than at a step the reader never took.
 * O(n) for n mountains.
 */
export function originContinent(
	mountains: readonly MountainIndexEntry[],
	browsed: ContinentBrowse | null
): RangeOrigin | undefined {
	if (browsed === null) {
		return undefined;
	}

	const found = mountains.find(({ continent }) => continent.code === browsed.code);

	return (
		found && { code: found.continent.code, name: found.continent.name, ranges: browsed.ranges }
	);
}

/** What the atlas list needs to browse continents and ranges; absent until the page is interactive. */
export interface RangeNavigation {
	/** The topmost ranges of each continent, for the continents' way into them. */
	byContinent: ReadonlyMap<string, readonly RangeOption[]>;
	/** The continent the reader is in, when no range is browsed, and what it shows. */
	continent: ContinentLevel | undefined;
	/** The range being browsed, if the range filter is on. */
	place: RangePlace | undefined;
	/** Where the way up from `place` starts, when it starts at a continent. */
	origin: RangeOrigin | undefined;
	/**
	 * What the atlas is called once no continent or range is browsed: all continents, or the flat
	 * list the filters and sort leave. Where the way up leads when there is no continent to go to.
	 */
	atlasLabel: string;
	/** Browses a range, or with `null` leaves the range filter off. */
	choose: (slug: string | null) => void;
	/** Goes into a continent, to its mountains or its ranges, or with `null` back to all continents. */
	browseContinent: (next: { code: string; ranges: boolean } | null) => void;
}

export interface ContinentLevel extends RangeContinent {
	/** Its ranges, not its mountains, are what is listed. */
	showRanges: boolean;
	/** The topmost ranges the filters leave it. */
	ranges: readonly RangeOption[];
	/** The matching mountains on it, in list order. */
	mountains: readonly MountainIndexEntry[];
}
