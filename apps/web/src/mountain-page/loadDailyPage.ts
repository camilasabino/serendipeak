import type { MountainApi } from '../api/MountainApi';
import { failedLoad, foundLoad, NO_STORE, type PageLoad } from './pageModel';

// The daily identity changes at midnight UTC and the backend answers `no-store` on every outcome,
// so the page must not be cached by a shared cache either, errors included.
export async function loadDailyPage(api: MountainApi): Promise<PageLoad> {
	const result = await api.getDailyMountain();
	if (result.kind === 'found') {
		return foundLoad({ kind: 'daily', daily: result.daily }, NO_STORE);
	}

	return failedLoad(result.kind, NO_STORE);
}
