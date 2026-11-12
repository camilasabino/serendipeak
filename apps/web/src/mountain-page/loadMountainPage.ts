import { isValidSlug } from '../api/schema';
import type { MountainApi } from '../api/MountainApi';
import { failedLoad, foundLoad, type PageLoad } from './pageModel';
import type { MountainPageModel } from './applyPageLoad';

// A slug the backend would never serve must not reach the API: `.` and `..` would escape the
// endpoint path, and `today` would persist the day's discovery as a side effect.
export async function loadMountainPage(
	api: MountainApi,
	slug: string
): Promise<PageLoad<MountainPageModel>> {
	if (!isValidSlug(slug)) {
		return failedLoad('not-found');
	}

	const result = await api.getMountain(slug);
	if (result.kind === 'found') {
		return foundLoad({ kind: 'mountain', mountain: result.mountain });
	}

	return failedLoad(result.kind);
}
