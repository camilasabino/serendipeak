import type { DailyMountain, Mountain } from '../api/contract';

export type FailureReason = 'not-found' | 'unreachable' | 'no-eligible-mountains' | 'api-error';

export type FailureStatus = 404 | 502 | 503;

export type PageModel =
	| { kind: 'mountain'; mountain: Mountain; preview?: true }
	| { kind: 'daily'; daily: DailyMountain }
	| { kind: 'error'; reason: FailureReason };

export type MountainModel = Exclude<PageModel, { kind: 'error' }>;

export function mountainOf(model: MountainModel): Mountain {
	return model.kind === 'daily' ? model.daily.mountain : model.mountain;
}

export interface PageLoad {
	model: PageModel;
	status: 200 | FailureStatus;
	cacheControl?: string;
	noindex?: true;
}

export function pageModelOf(pageProps: object): PageModel | undefined {
	const model = 'model' in pageProps ? pageProps.model : undefined;

	return typeof model === 'object' && model !== null && 'kind' in model
		? (model as PageModel)
		: undefined;
}

export const NO_STORE = 'no-store';
export const PRIVATE_NO_STORE = 'private, no-store';

const FAILURE_STATUS: Record<FailureReason, FailureStatus> = {
	'not-found': 404,
	unreachable: 503,
	'no-eligible-mountains': 503,
	'api-error': 502
};

export function classifyFailure(reason: FailureReason): FailureStatus {
	return FAILURE_STATUS[reason];
}

export function foundLoad(model: PageModel, cacheControl?: string): PageLoad {
	return withCacheControl({ model, status: 200 }, cacheControl);
}

export function previewLoad(mountain: Mountain): PageLoad {
	return {
		model: { kind: 'mountain', mountain, preview: true },
		status: 200,
		cacheControl: PRIVATE_NO_STORE,
		noindex: true
	};
}

export function failedLoad(reason: FailureReason, cacheControl?: string): PageLoad {
	return withCacheControl(
		{ model: { kind: 'error', reason }, status: classifyFailure(reason) },
		cacheControl
	);
}

function withCacheControl(load: PageLoad, cacheControl: string | undefined): PageLoad {
	return cacheControl === undefined ? load : { ...load, cacheControl };
}
