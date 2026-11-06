import { PITCH_MAX, PITCH_MIN, RANGE_MAX, RANGE_MIN } from '../../api/cameraBounds';
import type { CameraProblem } from './canonicalCamera';
import type { CameraOrigin } from './editorQuery';

export const EDITOR_TITLE = 'Camera editor';
export const SAVE_LABEL = 'Save camera…';
export const BACK_LABEL = 'Back to the mountain';

export const INVALID_LINK_TITLE = 'This camera link is not valid';
export const INVALID_LINK_MESSAGE =
	'Open the camera editor again from the mountain in the editorial Admin.';
export const MISSING_CONFIG_TITLE = 'The camera editor is not configured';
export const MISSING_CONFIG_MESSAGE =
	'The Admin address is missing from this site’s configuration.';
export const OPENING_LABEL = 'Opening the camera editor…';

const RESTORE_LABEL: Record<CameraOrigin, string> = {
	saved: 'Restore saved camera',
	proposed: 'Restore proposed camera',
	none: 'Restore automatic view'
};

const OPENED_ON_LABEL: Record<CameraOrigin, string> = {
	saved: 'Opened on the saved camera.',
	proposed: 'Opened on the camera you proposed. It is not saved yet.',
	none: 'No saved camera yet: opened on the automatic view.'
};

export function restoreLabel(origin: CameraOrigin): string {
	return RESTORE_LABEL[origin];
}

export function openedOnLabel(origin: CameraOrigin): string {
	return OPENED_ON_LABEL[origin];
}

export const STATE_COPY = {
	unavailable: 'The globe is not available, so the camera cannot be edited.',
	loading: 'Loading the globe…',
	flying: 'Moving the view…',
	ready: 'Ready to save.'
} as const;

const PROBLEM_COPY: Record<CameraProblem, string> = {
	'out-of-bounds': `Outside the allowed limits: pitch from ${PITCH_MIN} to ${PITCH_MAX} degrees, range from ${RANGE_MIN} to ${RANGE_MAX} meters.`,
	'framing-missing': 'The summit is outside the view. Bring it back on screen to save.',
	'framing-out-of-bounds': 'The summit is outside the view. Bring it back on screen to save.'
};

export function problemsCopy(problems: readonly CameraProblem[]): string[] {
	return [...new Set(problems.map((problem) => PROBLEM_COPY[problem]))];
}
