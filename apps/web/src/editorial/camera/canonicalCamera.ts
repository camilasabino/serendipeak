import {
	isFramingInBounds,
	isHeadingInBounds,
	isPitchInBounds,
	isRangeInBounds
} from '../../api/cameraBounds';
import type { CameraFraming } from '../../stage/globe/framing';
import type { SceneCamera } from '../../stage/globe/camera';

export interface CanonicalCamera extends SceneCamera {
	framing: CameraFraming;
}

export type CameraProblem = 'out-of-bounds' | 'framing-missing' | 'framing-out-of-bounds';

export type CameraAssessment =
	| { valid: true; camera: CanonicalCamera }
	| { valid: false; camera: SceneCamera; problems: readonly CameraProblem[] };

// Adding zero turns a rounded -0 into 0, so a saved value never reads "-0".
function roundTo(value: number, decimals: number): number {
	return Number(value.toFixed(decimals)) + 0;
}

// Mirrors the catalog's stored precision: what is shown and saved is what the public page replays.
export function quantizeCamera(camera: SceneCamera): SceneCamera {
	// Wrap first and round after: wrapping a rounded value reintroduces binary noise (123.46 % 360).
	const wrapped = roundTo(((camera.headingDegrees % 360) + 360) % 360, 2);
	const quantized: SceneCamera = {
		// A heading that rounds up to 360 is 0, never the excluded upper bound.
		headingDegrees: wrapped >= 360 ? 0 : wrapped,
		pitchDegrees: roundTo(camera.pitchDegrees, 2),
		rangeMeters: Math.round(camera.rangeMeters)
	};
	if (camera.framing) {
		quantized.framing = { x: roundTo(camera.framing.x, 4), y: roundTo(camera.framing.y, 4) };
	}

	return quantized;
}

// Written as inclusion tests so that NaN, which compares false, is out of bounds.
export function assessCamera(reading: SceneCamera): CameraAssessment {
	const camera = quantizeCamera(reading);
	const problems: CameraProblem[] = [];

	if (!(
		isHeadingInBounds(camera.headingDegrees) &&
		isPitchInBounds(camera.pitchDegrees) &&
		isRangeInBounds(camera.rangeMeters)
	)) {
		problems.push('out-of-bounds');
	}
	if (!camera.framing) {
		problems.push('framing-missing');
	} else if (!(isFramingInBounds(camera.framing.x) && isFramingInBounds(camera.framing.y))) {
		problems.push('framing-out-of-bounds');
	}

	if (problems.length > 0 || !camera.framing) {
		return { valid: false, camera, problems };
	}

	return { valid: true, camera: { ...camera, framing: camera.framing } };
}

export function sameAssessment(a: CameraAssessment | undefined, b: CameraAssessment | undefined) {
	if (!a || !b) {
		return a === b;
	}

	return (
		a.valid === b.valid &&
		a.camera.headingDegrees === b.camera.headingDegrees &&
		a.camera.pitchDegrees === b.camera.pitchDegrees &&
		a.camera.rangeMeters === b.camera.rangeMeters &&
		a.camera.framing?.x === b.camera.framing?.x &&
		a.camera.framing?.y === b.camera.framing?.y
	);
}
