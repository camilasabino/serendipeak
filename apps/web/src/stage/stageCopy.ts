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

export const START_MOUNTAIN_ORBIT_LABEL = 'Start mountain orbit';
export const PAUSE_MOUNTAIN_ORBIT_LABEL = 'Pause mountain orbit';
export const RESUME_MOUNTAIN_ORBIT_LABEL = 'Resume mountain orbit';

export const HIDE_MARKERS_LABEL = 'Hide mountain markers';
export const SHOW_MARKERS_LABEL = 'Show mountain markers';

export const ENTER_FULLSCREEN_LABEL = 'Enter fullscreen';
export const EXIT_FULLSCREEN_LABEL = 'Exit fullscreen';

export const ZOOM_IN_LABEL = 'Zoom in';
export const ZOOM_OUT_LABEL = 'Zoom out';
export const ZOOM_GROUP_LABEL = 'Zoom';

export const NAVIGATION_HELP_LABEL = 'How to navigate';
export const CLOSE_NAVIGATION_HELP_LABEL = 'Close navigation help';

export type GuideTab = 'mouse' | 'touch' | 'controls';

export const GUIDE_TAB_LABELS: Record<GuideTab, string> = {
	mouse: 'Mouse',
	touch: 'Touch',
	controls: 'Controls'
};

export const GUIDE_TABS: readonly GuideTab[] = ['mouse', 'touch', 'controls'];

export type GuideIcon =
	| 'move'
	| 'scroll'
	| 'tilt-rotate'
	| 'open'
	| 'drag-one'
	| 'pinch'
	| 'drag-two'
	| 'twist'
	| 'zoom'
	| 'reset'
	| 'rotation'
	| 'markers'
	| 'orbit'
	| 'fullscreen';

export interface GuideRow {
	icon: GuideIcon;
	action: string;
	description: string;
}

export interface GuideContent {
	rows: readonly GuideRow[];
	/** One line under the rows, for what a row cannot say on its own. */
	note?: string;
}

/**
 * What the guide may describe: the atlas explains its markers, rotation and overview, a mountain
 * its orbit and starting view, and neither mentions the other's controls. The buttons listed are
 * those the stage shows now.
 */
export type NavigationHelpContext =
	| { kind: 'atlas'; markersHidden: boolean; rotation: boolean; fullscreen: boolean }
	| { kind: 'mountain'; orbit: boolean; fullscreen: boolean };

const FULLSCREEN_ROW: GuideRow = {
	icon: 'fullscreen',
	action: 'Fullscreen',
	description: 'Fill the screen'
};

const ZOOM_ROW: GuideRow = { icon: 'zoom', action: '+ and −', description: 'Zoom one step' };

// Each gesture is a camera binding this stage actually has: Cesium's defaults, plus a trackpad
// pinch, which browsers report as Ctrl and the wheel.
function gestureRows(tab: 'mouse' | 'touch', context: NavigationHelpContext): readonly GuideRow[] {
	const openable = context.kind === 'atlas' && !context.markersHidden;
	if (tab === 'mouse') {
		return [
			{ icon: 'move', action: 'Move', description: 'Drag the globe' },
			{ icon: 'scroll', action: 'Zoom', description: 'Scroll, or right-drag' },
			{ icon: 'tilt-rotate', action: 'Tilt & rotate', description: 'Ctrl + drag' },
			...(openable
				? [{ icon: 'open' as const, action: 'Open', description: 'Click a point or name' }]
				: [])
		];
	}

	return [
		{ icon: 'drag-one', action: 'Move', description: 'Drag with one finger' },
		{ icon: 'pinch', action: 'Zoom', description: 'Pinch' },
		{ icon: 'drag-two', action: 'Tilt', description: 'Drag two fingers up or down' },
		{ icon: 'twist', action: 'Turn', description: 'Twist two fingers' },
		...(openable
			? [{ icon: 'open' as const, action: 'Open', description: 'Tap a point or name' }]
			: [])
	];
}

function controlRows(context: NavigationHelpContext): readonly GuideRow[] {
	if (context.kind === 'mountain') {
		return [
			ZOOM_ROW,
			{ icon: 'reset', action: 'Reset view', description: 'Back to the starting view' },
			...(context.orbit
				? [
						{
							icon: 'orbit' as const,
							action: '360° orbit',
							description: 'Circle the summit'
						}
					]
				: []),
			...(context.fullscreen ? [FULLSCREEN_ROW] : [])
		];
	}

	return [
		ZOOM_ROW,
		{ icon: 'reset', action: 'Reset view', description: 'Back to the Atlas overview' },
		...(context.rotation
			? [
					{
						icon: 'rotation' as const,
						action: 'Rotation',
						description: 'Pause or resume the turn'
					}
				]
			: []),
		{
			icon: 'markers',
			action: 'Markers',
			description: context.markersHidden ? 'Show the mountain markers' : 'Hide the mountain markers'
		},
		...(context.fullscreen ? [FULLSCREEN_ROW] : [])
	];
}

export function navigationGuide(context: NavigationHelpContext): Record<GuideTab, GuideContent> {
	const gestureNote =
		context.kind === 'atlas' && !context.markersHidden
			? 'Where points overlap, a short list opens.'
			: undefined;
	const controlsNote =
		context.kind === 'atlas'
			? context.markersHidden
				? 'Markers are hidden. Every mountain is still in the list and in Search.'
				: undefined
			: context.orbit
				? 'Moving the map yourself stops the orbit.'
				: undefined;

	return {
		mouse: { rows: gestureRows('mouse', context), note: gestureNote },
		touch: { rows: gestureRows('touch', context), note: gestureNote },
		controls: { rows: controlRows(context), note: controlsNote }
	};
}

// Each tooltip says what pressing the button does now, so it follows the state the label follows.
export const TOOLTIP_UNAVAILABLE = 'Available once the view settles';
export const ZOOM_IN_TOOLTIP = 'Zoom in — Move closer';
export const ZOOM_OUT_TOOLTIP = 'Zoom out — Move farther away';
export const RESET_VIEW_TOOLTIP = 'Reset to the original view';
export const NAVIGATION_HELP_TOOLTIP = 'View navigation instructions';
export const PAUSE_ROTATION_TOOLTIP = 'Pause globe rotation';
export const RESUME_ROTATION_TOOLTIP = 'Resume globe rotation';
export const START_MOUNTAIN_ORBIT_TOOLTIP = 'Start 360° orbit';
export const PAUSE_MOUNTAIN_ORBIT_TOOLTIP = 'Pause 360° orbit';
export const RESUME_MOUNTAIN_ORBIT_TOOLTIP = 'Resume 360° orbit';
export const HIDE_MARKERS_TOOLTIP = 'Hide mountain markers';
export const SHOW_MARKERS_TOOLTIP = 'Show mountain markers';
export const ENTER_FULLSCREEN_TOOLTIP = 'Enter fullscreen';
export const EXIT_FULLSCREEN_TOOLTIP = 'Exit fullscreen';
