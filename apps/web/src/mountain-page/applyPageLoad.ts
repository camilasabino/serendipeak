import type { ServerResponse } from 'node:http';
import type { PageLoad, PageModel } from './pageModel';

export interface MountainPageProps {
	model: PageModel;
}

export function applyPageLoad(
	response: Pick<ServerResponse, 'statusCode' | 'setHeader'>,
	load: PageLoad
): { props: MountainPageProps } {
	response.statusCode = load.status;
	if (load.cacheControl !== undefined) {
		response.setHeader('Cache-Control', load.cacheControl);
	}

	if (load.noindex) {
		response.setHeader('X-Robots-Tag', 'noindex');
	}

	return { props: { model: load.model } };
}
