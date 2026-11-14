import type { HitMountain } from '../stage/globe/markerHits';

// Base sensitivity files "Écrins" beside "Ecrins" and ignores case, so the order is the one a
// reader scanning for a name expects; the slug then settles every remaining tie.
const NAMES = new Intl.Collator('en', { sensitivity: 'base' });

function compareMountains(a: HitMountain, b: HitMountain): number {
	const byName = NAMES.compare(a.name, b.name);
	if (byName !== 0) {
		return byName;
	}

	return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * The mountains of a choice as the chooser lists them: alphabetically by name, so a reader can
 * find one by scanning rather than by guessing which was nearest the press. The order depends only
 * on the mountains, never on where they were pressed or in what order they were found.
 * O(n log n); n is the handful of markers that merge on screen.
 */
export function inChooserOrder(mountains: readonly HitMountain[]): HitMountain[] {
	return [...mountains].sort(compareMountains);
}
