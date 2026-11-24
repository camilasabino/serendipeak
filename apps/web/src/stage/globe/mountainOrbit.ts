import { MIN_TERRAIN_CLEARANCE_METERS } from './zoomStep';

/** One revolution around the summit: slow enough to read as an aerial survey, not a spin. */
export const MOUNTAIN_ORBIT_PERIOD_SECONDS = 60;

/** A frame later than this (a stalled tab, a debugger) turns the view by this much and no more. */
export const MAX_ORBIT_FRAME_SECONDS = 0.1;

/** How far ahead along its path the orbit reads the ground, so a climb begins before a ridge. */
export const LIFT_LOOKAHEAD_SECONDS = 5;
export const LIFT_LOOKAHEAD_SAMPLES = 10;

/** The clearance the orbit climbs to keep over the ground ahead. */
export const ORBIT_CLEARANCE_METERS = MIN_TERRAIN_CLEARANCE_METERS;

const DEGREE = Math.PI / 180;
const FULL_TURN = 2 * Math.PI;

// A climb is quicker than the settle back down: the ground ahead sets the first, while the second
// only returns to the reader's own tilt. Both start and stop gently, so terrain never jolts the view.
const MAX_CLIMB_RATE = 2.5 * DEGREE;
const MAX_SETTLE_RATE = 0.75 * DEGREE;
const LIFT_ACCELERATION = 2.5 * DEGREE;
const LIFT_GAIN = 1.5;

// The ground a path crosses rises by about the same distance per degree turned, so the lift the
// correction may add scales with the time the frame took, as the turn does. A fixed amount per
// frame would halt the orbit on the same ridge whenever frames run long.
const MAX_LIFT_CORRECTION_RATE = 6 * DEGREE;

/** No climb ever looks down at the summit more steeply than this from above. */
export const MAX_ORBIT_ELEVATION = 70 * DEGREE;

/**
 * How far the orbit has raised the camera around the summit above where the reader left it, in
 * radians of elevation seen from the summit, and how fast that is changing.
 */
export interface OrbitLift {
	radians: number;
	rate: number;
}

export const NO_LIFT: OrbitLift = { radians: 0, rate: 0 };

/**
 * The angle the orbit has turned through after a frame that came `elapsedSeconds` after the last,
 * kept within one revolution so a long orbit never loses precision as it goes round.
 */
export function advanceOrbitAngle(
	angleRadians: number,
	elapsedSeconds: number,
	periodSeconds: number
): number {
	const next = angleRadians + (FULL_TURN * frameSeconds(elapsedSeconds)) / periodSeconds;

	return next >= FULL_TURN ? next - FULL_TURN : next;
}

/**
 * How close to the ground the orbit may ever carry the camera. A camera the reader already brought
 * lower than the usual floor keeps its own height as the floor, so the orbit can start there.
 */
export function orbitClearanceFloorMeters(startClearanceMeters: number | undefined): number {
	return Math.min(MIN_TERRAIN_CLEARANCE_METERS, startClearanceMeters ?? Number.POSITIVE_INFINITY);
}

/**
 * The lift that raises a camera `rangeMeters` from the summit, seen at `startElevation` plus
 * `lift` above it, by `climbMeters` more, keeping its range. Never below the reader's own pose,
 * and never above the steepest elevation allowed.
 */
export function liftForClimb(
	startElevation: number,
	lift: number,
	rangeMeters: number,
	climbMeters: number
): number {
	const height = rangeMeters * Math.sin(startElevation + lift) + climbMeters;
	const elevation = Math.asin(Math.min(1, Math.max(-1, height / rangeMeters)));

	return Math.max(0, Math.min(elevation, MAX_ORBIT_ELEVATION) - startElevation);
}

/**
 * Moves the lift toward `targetRadians` over one frame: its rate follows the gap, within a climb
 * and a settle limit, and changes no faster than a gentle acceleration allows.
 */
export function easeLift(
	lift: OrbitLift,
	targetRadians: number,
	elapsedSeconds: number
): OrbitLift {
	const seconds = frameSeconds(elapsedSeconds);
	const wanted = Math.min(
		MAX_CLIMB_RATE,
		Math.max(-MAX_SETTLE_RATE, (targetRadians - lift.radians) * LIFT_GAIN)
	);
	const change = LIFT_ACCELERATION * seconds;
	const rate = Math.min(lift.rate + change, Math.max(lift.rate - change, wanted));
	const radians = lift.radians + rate * seconds;

	return radians > 0 ? { radians, rate } : NO_LIFT;
}

/**
 * The most the orbit may raise the camera in one frame to stay clear of ground the look ahead
 * missed, such as ground just loaded or a pose that starts grazing it. Anything more would read as
 * a jolt, and the orbit halts instead.
 */
export function maxLiftCorrection(elapsedSeconds: number): number {
	return MAX_LIFT_CORRECTION_RATE * frameSeconds(elapsedSeconds);
}

function frameSeconds(elapsedSeconds: number): number {
	return Math.min(Math.max(elapsedSeconds, 0), MAX_ORBIT_FRAME_SECONDS);
}
