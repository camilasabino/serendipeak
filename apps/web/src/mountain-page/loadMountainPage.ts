import type { MountainApi } from '../api/MountainApi';
import { failedLoad, foundLoad, type PageLoad } from './pageModel';

// The backend serves these paths as stateful routes. `today` persists the day's discovery, so
// a permalink request for one must never reach the API as a slug lookup.
const RESERVED_PERMALINK_SLUGS: ReadonlySet<string> = new Set(['today', 'random']);

export async function loadMountainPage(api: MountainApi, slug: string): Promise<PageLoad> {
	if (RESERVED_PERMALINK_SLUGS.has(slug)) {
		return failedLoad('not-found');
	}

	const result = await api.getMountain(slug);
	if (result.kind === 'found') {
		return foundLoad({ kind: 'mountain', mountain: result.mountain });
	}

	return failedLoad(result.kind);
}
