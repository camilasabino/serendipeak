import type { SceneFailure } from './sceneState';

export const FAILURE_MESSAGES: Record<SceneFailure, string> = {
	'missing-token': "The 3D globe isn't available on this site.",
	'initialization-failed': 'The 3D globe could not be loaded.'
};

export const DETAILS_AVAILABLE_MESSAGE = 'The mountain details are still available.';

export const RESET_VIEW_LABEL = 'Reset view';

export const ENTER_FULLSCREEN_LABEL = 'Enter fullscreen';
export const EXIT_FULLSCREEN_LABEL = 'Exit fullscreen';
