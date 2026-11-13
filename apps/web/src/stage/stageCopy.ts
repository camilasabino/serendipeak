import type { SceneFailure } from './sceneState';

export const FAILURE_MESSAGES: Record<SceneFailure, string> = {
	'missing-token': "The 3D globe isn't available on this site.",
	'initialization-failed': 'The 3D globe could not be loaded.'
};

export const IMAGERY_DEGRADED_MESSAGE = 'Map imagery is temporarily unavailable.';

export const RETRY_LABEL = 'Try again';

export const DETAILS_AVAILABLE_MESSAGE = 'The mountain details are still available.';

export const RESET_VIEW_LABEL = 'Reset view';

export const PAUSE_ROTATION_LABEL = 'Pause globe rotation';
export const RESUME_ROTATION_LABEL = 'Rotate the globe';

export const ENTER_FULLSCREEN_LABEL = 'Enter fullscreen';
export const EXIT_FULLSCREEN_LABEL = 'Exit fullscreen';

export const ZOOM_IN_LABEL = 'Zoom in';
export const ZOOM_OUT_LABEL = 'Zoom out';
export const ZOOM_GROUP_LABEL = 'Zoom';

export const NAVIGATION_HELP_LABEL = 'How to navigate';
export const CLOSE_NAVIGATION_HELP_LABEL = 'Close navigation help';

export interface NavigationGesture {
	action: string;
	gesture: string;
}

export interface NavigationHelpSection {
	heading: string;
	gestures: readonly NavigationGesture[];
}

// Each line describes the Cesium camera bindings this stage actually configures, not a wish list.
export const POINTER_NAVIGATION: NavigationHelpSection = {
	heading: 'Mouse and trackpad',
	gestures: [
		{ action: 'Move', gesture: 'Drag the map.' },
		{ action: 'Zoom', gesture: 'Scroll, or drag with the right button.' },
		{
			action: 'Tilt and turn',
			gesture: 'Hold Ctrl and drag: up and down tilts, left and right turns.'
		}
	]
};

export const TOUCH_NAVIGATION: NavigationHelpSection = {
	heading: 'Touch',
	gestures: [
		{ action: 'Move', gesture: 'Drag with one finger.' },
		{ action: 'Zoom', gesture: 'Pinch with two fingers.' },
		{ action: 'Tilt', gesture: 'Drag two fingers up or down.' },
		{ action: 'Turn', gesture: 'Twist two fingers.' }
	]
};

// Shown only where the globe carries atlas markers.
export const MARKER_NAVIGATION: NavigationHelpSection = {
	heading: 'Mountains',
	gestures: [
		{ action: 'Open', gesture: "Click or tap a mountain's point or name." },
		{
			action: 'Close together',
			gesture: 'Where points overlap, pick one from the short list that opens, or zoom in.'
		},
		{ action: 'Without the globe', gesture: 'Every mountain is also in the list and in Search.' }
	]
};

export const BUTTON_NAVIGATION: NavigationHelpSection = {
	heading: 'Buttons',
	gestures: [
		{ action: '+ and −', gesture: 'Zoom in or out one step.' },
		{ action: 'Reset view', gesture: 'Return to the starting view.' }
	]
};
