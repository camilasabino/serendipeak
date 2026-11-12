import type { MountainApi, MountainPreviewApi } from '../api/MountainApi';
import type { PreviewGrant } from '../editorial/preview/previewGrant';
import { loadMountainPage } from './loadMountainPage';
import { previewLoad, type PageLoad } from './pageModel';
import type { MountainPageModel } from './applyPageLoad';

// A grant counts only for the page it was made for. Anything else, an expired or refused token
// included, serves the public page, which is a 404 for a draft: a stale cookie never shows another
// mountain and never changes what a visitor would see.
export async function loadMountainPreviewPage(
	api: MountainApi & MountainPreviewApi,
	slug: string,
	grant: PreviewGrant | undefined
): Promise<PageLoad<MountainPageModel>> {
	if (grant?.slug === slug) {
		const result = await api.getMountainPreview(grant.token);
		if (result.kind === 'found' && result.mountain.slug === slug) {
			return previewLoad(result.mountain);
		}
	}

	return loadMountainPage(api, slug);
}
