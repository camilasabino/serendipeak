import type { MountainIndexEntry } from '../api/contract';

export type AtlasSort = 'name' | 'elevation-desc' | 'elevation-asc';

export const DEFAULT_ATLAS_SORT: AtlasSort = 'name';
export const ATLAS_SORTS: readonly AtlasSort[] = ['name', 'elevation-desc', 'elevation-asc'];

// Base sensitivity files "Écrins" beside "Ecrins" and ignores case, so the order is the one a
// reader scanning for a name expects.
const NAMES = new Intl.Collator('en', { sensitivity: 'base' });

export function compareByName(a: { name: string }, b: { name: string }): number {
	return NAMES.compare(a.name, b.name);
}

/** Name, then slug, so the order never depends on the order the index was served in. */
export function compareByNameThenSlug(
	a: { name: string; slug: string },
	b: { name: string; slug: string }
): number {
	return compareByName(a, b) || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0);
}

function compareBy(sort: AtlasSort) {
	switch (sort) {
		case 'name':
			return compareByNameThenSlug;
		case 'elevation-desc':
			return (a: MountainIndexEntry, b: MountainIndexEntry) =>
				b.elevationMeters - a.elevationMeters || compareByNameThenSlug(a, b);
		case 'elevation-asc':
			return (a: MountainIndexEntry, b: MountainIndexEntry) =>
				a.elevationMeters - b.elevationMeters || compareByNameThenSlug(a, b);
	}
}

/** A new array, ordered across the whole of it. O(n log n) for n mountains. */
export function sortMountains(
	mountains: readonly MountainIndexEntry[],
	sort: AtlasSort
): MountainIndexEntry[] {
	return [...mountains].sort(compareBy(sort));
}
