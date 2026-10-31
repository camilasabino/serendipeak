export type SceneFailure = 'missing-token' | 'initialization-failed';

export type SceneState =
	| { status: 'loading' }
	| { status: 'ready'; imageryDegraded?: true }
	| { status: 'failed'; failure: SceneFailure; message: string };
