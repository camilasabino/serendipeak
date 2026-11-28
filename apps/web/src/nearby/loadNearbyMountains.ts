import type { Mountain } from '../api/contract';
import type { MountainApi } from '../api/MountainApi';
import type { MountainPageModel } from '../mountain-page/applyPageLoad';
import { mountainOf } from '../mountain-page/pageModel';
import { findNearbyMountains, type NearbyMountain } from './findNearbyMountains';

/**
 * The page's neighbours, or none when the index cannot be had. They are supplementary: whatever
 * goes wrong here must leave the mountain page exactly as it would be without them, so a failed
 * answer and a thrown error both end in an empty list.
 */
export async function loadNearbyMountains(
	api: Pick<MountainApi, 'getMountainIndex'>,
	mountain: Pick<Mountain, 'slug' | 'coordinates'>
): Promise<NearbyMountain[]> {
	try {
		const result = await api.getMountainIndex();

		return result.kind === 'found' ? findNearbyMountains(mountain, result.mountains) : [];
	} catch (error) {
		console.error('Nearby mountains could not be loaded', error);

		return [];
	}
}

/** The neighbours of the mountain a page presents; an error page has none, and asks for nothing. */
export function loadNearbyFor(
	api: Pick<MountainApi, 'getMountainIndex'>,
	model: MountainPageModel
): Promise<NearbyMountain[]> {
	return model.kind === 'error' ? Promise.resolve([]) : loadNearbyMountains(api, mountainOf(model));
}
