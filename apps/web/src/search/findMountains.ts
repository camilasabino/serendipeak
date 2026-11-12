import type { MountainIndexEntry } from '../api/contract';
import { foldName } from './foldName';

export interface SearchableMountain {
	readonly entry: MountainIndexEntry;
	readonly folded: string;
}

export type SearchableIndex = readonly SearchableMountain[];

// Lower ranks are listed first.
const NAME_START = 0;
const WORD_START = 1;
const INSIDE = 2;
type MatchRank = typeof NAME_START | typeof WORD_START | typeof INSIDE;

// Folded once per loaded index, so a keystroke only scans the prepared names.
export function prepareIndex(entries: readonly MountainIndexEntry[]): SearchableIndex {
	return entries.map((entry) => ({ entry, folded: foldName(entry.name) }));
}

function rankOf(folded: string, needle: string): MatchRank | undefined {
	const at = folded.indexOf(needle);
	if (at === -1) {
		return undefined;
	}
	if (at === 0) {
		return NAME_START;
	}

	return folded.includes(` ${needle}`) ? WORD_START : INSIDE;
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The mountains whose name contains the query, ignoring case, accents and punctuation: names that
 * start with it first, then names with a word that starts with it, then any other match, each group
 * by folded name and then slug. An empty query matches nothing.
 */
export function findMountains(index: SearchableIndex, query: string): MountainIndexEntry[] {
	const needle = foldName(query);
	if (needle === '') {
		return [];
	}

	const matches: { mountain: SearchableMountain; rank: MatchRank }[] = [];
	for (const mountain of index) {
		const rank = rankOf(mountain.folded, needle);
		if (rank !== undefined) {
			matches.push({ mountain, rank });
		}
	}

	return matches
		.sort(
			(a, b) =>
				a.rank - b.rank ||
				compareCodePoints(a.mountain.folded, b.mountain.folded) ||
				compareCodePoints(a.mountain.entry.slug, b.mountain.entry.slug)
		)
		.map(({ mountain }) => mountain.entry);
}
