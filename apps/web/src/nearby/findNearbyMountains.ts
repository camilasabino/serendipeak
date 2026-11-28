import type { Coordinates, MountainIndexEntry } from '../api/contract';
import { placeOf } from '../mountain-index/describeEntry';
import { greatCircleDistanceKm } from './greatCircle';

/** How far a mountain can be and still count as nearby. Adjust here; nothing else assumes it. */
export const NEARBY_MAX_DISTANCE_KM = 1000;

/** How many nearby mountains a page lists. */
export const NEARBY_LIMIT = 3;

/** What a page needs to list a neighbour; small, because it travels in the page's props. */
export interface NearbyMountain {
	slug: string;
	name: string;
	/** Where it is, ready to show. */
	place: string;
	elevationMeters: number;
	/** The summit's position, so the stage can point toward it. */
	coordinates: Coordinates;
	/** Straight-line distance between the summits, unrounded. */
	distanceKm: number;
}

export interface NearbyOptions {
	maxDistanceKm?: number;
	limit?: number;
}

/**
 * The mountains of `index` closest to `origin` as the crow flies, nearest first, within the
 * maximum distance and never more than the limit. The list is shorter, or empty, when the catalog
 * has nothing that close: a far mountain is not padded in. The origin's own entry is skipped by
 * slug, and equal distances are ordered by slug so the answer never depends on the index's order.
 * One pass over the index and a sort of the matches: O(n log n) for n mountains.
 */
export function findNearbyMountains(
	origin: { slug: string; coordinates: Coordinates },
	index: readonly MountainIndexEntry[],
	{ maxDistanceKm = NEARBY_MAX_DISTANCE_KM, limit = NEARBY_LIMIT }: NearbyOptions = {}
): NearbyMountain[] {
	const candidates: NearbyMountain[] = [];

	for (const entry of index) {
		if (entry.slug === origin.slug) {
			continue;
		}

		const distanceKm = greatCircleDistanceKm(origin.coordinates, entry.coordinates);
		if (distanceKm > maxDistanceKm) {
			continue;
		}

		candidates.push({
			slug: entry.slug,
			name: entry.name,
			place: placeOf(entry),
			elevationMeters: entry.elevationMeters,
			coordinates: { latitude: entry.coordinates.latitude, longitude: entry.coordinates.longitude },
			distanceKm
		});
	}

	return candidates.sort(byDistanceThenSlug).slice(0, Math.max(0, limit));
}

function byDistanceThenSlug(a: NearbyMountain, b: NearbyMountain): number {
	if (a.distanceKm !== b.distanceKm) {
		return a.distanceKm - b.distanceKm;
	}

	return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}
