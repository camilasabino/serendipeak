import type { DailyMountain, Mountain, MountainIndexEntry } from '../api/contract';

export type FailureReason = 'not-found' | 'unreachable' | 'no-eligible-mountains' | 'api-error';

export type FailureStatus = 404 | 502 | 503;

export type PageModel =
	| { kind: 'mountain'; mountain: Mountain; preview?: true }
	| { kind: 'daily'; daily: DailyMountain }
	| { kind: 'atlas'; mountains: MountainIndexEntry[] }
	| { kind: 'error'; reason: FailureReason };

/** A page that presents one mountain. */
export type MountainModel = Extract<PageModel, { kind: 'mountain' | 'daily' }>;

export type AtlasModel = Extract<PageModel, { kind: 'atlas' }>;

export type ErrorModel = Extract<PageModel, { kind: 'error' }>;

/** A page rendered around the persistent 3D stage. */
export type StageModel = Exclude<PageModel, { kind: 'error' }>;

export function mountainOf(model: MountainModel): Mountain {
	return model.kind === 'daily' ? model.daily.mountain : model.mountain;
}

export interface PageLoad<M extends PageModel = PageModel> {
	model: M;
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

export function foundLoad<M extends PageModel>(model: M, cacheControl?: string): PageLoad<M> {
	return withCacheControl({ model, status: 200 }, cacheControl);
}

export function previewLoad(mountain: Mountain): PageLoad<MountainModel> {
	return {
		model: { kind: 'mountain', mountain, preview: true },
		status: 200,
		cacheControl: PRIVATE_NO_STORE,
		noindex: true
	};
}

export function failedLoad(reason: FailureReason, cacheControl?: string): PageLoad<ErrorModel> {
	return withCacheControl(
		{ model: { kind: 'error', reason }, status: classifyFailure(reason) },
		cacheControl
	);
}

function withCacheControl<M extends PageModel>(
	load: PageLoad<M>,
	cacheControl: string | undefined
): PageLoad<M> {
	return cacheControl === undefined ? load : { ...load, cacheControl };
}
