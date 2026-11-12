import type { MountainApi } from '../api/MountainApi';
import {
	failedLoad,
	foundLoad,
	type AtlasModel,
	type ErrorModel,
	type PageLoad
} from '../mountain-page/pageModel';

export async function loadAtlasPage(
	api: Pick<MountainApi, 'getMountainIndex'>
): Promise<PageLoad<AtlasModel | ErrorModel>> {
	const result = await api.getMountainIndex();
	if (result.kind === 'found') {
		return foundLoad({ kind: 'atlas', mountains: result.mountains });
	}

	return failedLoad(result.kind);
}
