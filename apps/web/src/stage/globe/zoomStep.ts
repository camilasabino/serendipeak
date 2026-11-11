export type ZoomDirection = 'in' | 'out';

/** `limit` means the camera is already as close or as far as an explicit zoom may take it. */
export type ZoomResult = 'zoomed' | 'limit' | 'unavailable';

export const ZOOM_FACTOR = 2;
export const ZOOM_FLIGHT_SECONDS = 0.5;

// Close enough to read a summit ridge, far enough that the near plane never cuts the terrain ahead.
export const MIN_FOCUS_DISTANCE_METERS = 300;
// The whole globe is in view well below this height; further out it only shrinks to a dot.
export const MAX_CAMERA_HEIGHT_METERS = 20_000_000;
export const MIN_TERRAIN_CLEARANCE_METERS = 50;

const MIN_TRAVEL_METERS = 1;
const CLEARANCE_SEARCH_STEPS = 12;

export interface ZoomGeometry {
	/** Distance from the camera to the surface point at the centre of the view. */
	focusDistanceMeters: number;
	cameraHeightMeters: number;
	/** Height the camera gains per metre it moves backwards along its view direction. */
	climbPerMeterBack: number;
}

/**
 * How far to move the camera along its view direction: positive is forward, negative is back, and
 * 0 means the step is at its limit or the geometry cannot be trusted.
 */
export function zoomTravelMeters(direction: ZoomDirection, geometry: ZoomGeometry): number {
	const { focusDistanceMeters, cameraHeightMeters, climbPerMeterBack } = geometry;
	if (
		!(focusDistanceMeters > 0) ||
		!Number.isFinite(focusDistanceMeters) ||
		!Number.isFinite(cameraHeightMeters) ||
		!Number.isFinite(climbPerMeterBack)
	) {
		return 0;
	}

	if (direction === 'in') {
		const closest = Math.max(focusDistanceMeters / ZOOM_FACTOR, MIN_FOCUS_DISTANCE_METERS);
		const forward = focusDistanceMeters - closest;
		return forward >= MIN_TRAVEL_METERS ? forward : 0;
	}

	let back = focusDistanceMeters * (ZOOM_FACTOR - 1);
	if (climbPerMeterBack > 0) {
		const headroom = MAX_CAMERA_HEIGHT_METERS - cameraHeightMeters;
		back = Math.min(back, Math.max(headroom, 0) / climbPerMeterBack);
	}
	return back >= MIN_TRAVEL_METERS ? -back : 0;
}

/**
 * The furthest travel, up to `travelMeters`, that keeps the camera clear of the terrain. The path is
 * a straight line, so a blocked end is reached by stopping short: lifting the destination instead
 * would tilt the view away from the focus. `clearanceAt` gives the height above ground after moving
 * that far, or undefined when the ground is not known there.
 */
export function clearedTravelMeters(
	travelMeters: number,
	clearanceAt: (travelMeters: number) => number | undefined
): number {
	const required = Math.min(
		MIN_TERRAIN_CLEARANCE_METERS,
		clearanceAt(0) ?? Number.POSITIVE_INFINITY
	);
	const clear = (distance: number) =>
		(clearanceAt(distance) ?? Number.POSITIVE_INFINITY) >= required;
	if (clear(travelMeters)) {
		return travelMeters;
	}

	const sign = Math.sign(travelMeters);
	let clearDistance = 0;
	let blockedDistance = Math.abs(travelMeters);
	for (let iteration = 0; iteration < CLEARANCE_SEARCH_STEPS; iteration += 1) {
		const middle = (clearDistance + blockedDistance) / 2;
		if (clear(sign * middle)) {
			clearDistance = middle;
		} else {
			blockedDistance = middle;
		}
	}

	return clearDistance >= MIN_TRAVEL_METERS ? sign * clearDistance : 0;
}

/** Quadratic ease in and out: the dolly starts and stops without a jump in speed. */
export function zoomProgress(fraction: number): number {
	const t = Math.min(1, Math.max(0, fraction));
	return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
}
