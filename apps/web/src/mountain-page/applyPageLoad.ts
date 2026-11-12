import type { ServerResponse } from 'node:http';
import type { ErrorModel, MountainModel, PageLoad, PageModel } from './pageModel';

export type MountainPageModel = MountainModel | ErrorModel;

export interface MountainPageProps {
	model: MountainPageModel;
}

export function applyPageLoad<M extends PageModel>(
	response: Pick<ServerResponse, 'statusCode' | 'setHeader'>,
	load: PageLoad<M>
): { props: { model: M } } {
	response.statusCode = load.status;
	if (load.cacheControl !== undefined) {
		response.setHeader('Cache-Control', load.cacheControl);
	}

	if (load.noindex) {
		response.setHeader('X-Robots-Tag', 'noindex');
	}

	return { props: { model: load.model } };
}
