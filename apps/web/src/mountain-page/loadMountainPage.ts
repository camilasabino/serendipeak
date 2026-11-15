import { isValidSlug } from '../api/schema';
import type { MountainApi } from '../api/MountainApi';
import { mountainHref } from '../explore/navigate';
import {
	failedLoad,
	foundLoad,
	permanentRedirect,
	type PageLoad,
	type PermanentRedirect
} from './pageModel';
import type { MountainPageModel } from './applyPageLoad';

// A slug the backend would never serve must not reach the API: `.` and `..` would escape the
// endpoint path, and `today` would persist the day's discovery as a side effect.
export async function loadMountainPage(
	api: MountainApi,
	slug: string
): Promise<PageLoad<MountainPageModel> | PermanentRedirect> {
	if (!isValidSlug(slug)) {
		return failedLoad('not-found');
	}

	const result = await api.getMountain(slug);
	if (result.kind === 'found') {
		// The API answers a slug a mountain used to have with the mountain under its current slug,
		// so a different slug in the answer is the address having moved. The slug was validated by
		// the API response schema, so the destination can only be a mountain path on this site.
		if (result.mountain.slug !== slug) {
			return permanentRedirect(mountainHref(result.mountain.slug));
		}

		return foundLoad({ kind: 'mountain', mountain: result.mountain });
	}

	return failedLoad(result.kind);
}
