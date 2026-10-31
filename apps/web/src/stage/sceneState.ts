export type SceneFailure = 'missing-token' | 'initialization-failed';

export type SceneState =
	| { status: 'loading' }
	| { status: 'ready'; imageryDegraded?: true }
	| { status: 'failed'; failure: SceneFailure; message: string };

export const INITIALIZATION_FAILED_STATE: SceneState = {
	status: 'failed',
	failure: 'initialization-failed',
	message: 'The 3D globe could not be loaded.'
};
