import type { MountainIndexEntry } from '../api/contract';

export interface ContinentGroup {
	code: string;
	name: string;
	mountains: MountainIndexEntry[];
}

const collator = new Intl.Collator('en', { sensitivity: 'base' });

function byName(a: { name: string }, b: { name: string }): number {
	return collator.compare(a.name, b.name);
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

	const sorted = [...groups.values()].sort(byName);
	for (const group of sorted) {
		group.mountains.sort(
			(a, b) => byName(a, b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
		);
	}

	return sorted;
}
