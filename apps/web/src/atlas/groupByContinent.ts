import type { MountainIndexEntry } from '../api/contract';
import { compareByName, compareByNameThenSlug } from './atlasSort';

export interface ContinentGroup {
	code: string;
	name: string;
	mountains: MountainIndexEntry[];
}

/**
 * Continents in alphabetical order, each with its mountains alphabetically by name and then slug,
 * so the list reads the same however the index is ordered. O(n log n) for n mountains.
 */
export function groupByContinent(mountains: readonly MountainIndexEntry[]): ContinentGroup[] {
	const groups = new Map<string, ContinentGroup>();
	for (const mountain of mountains) {
		const { code, name } = mountain.continent;
		const group = groups.get(code) ?? { code, name, mountains: [] };
		group.mountains.push(mountain);
		groups.set(code, group);
	}

	const sorted = [...groups.values()].sort(compareByName);
	for (const group of sorted) {
		group.mountains.sort(compareByNameThenSlug);
	}

	return sorted;
}
