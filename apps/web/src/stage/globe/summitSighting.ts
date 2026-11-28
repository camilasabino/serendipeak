import type { StageSize } from './stageFrame';

/** A summit the scene follows relative to the camera, named by the mountain's slug. */
export interface SightedSummit {
	slug: string;
	latitude: number;
	longitude: number;
	elevationMeters: number;
}

/** What to follow: the presented mountain, so a surface can keep clear of its marker, and its neighbours. */
export interface SightingRequest {
	presented: SightedSummit;
	nearby: readonly SightedSummit[];
}

/**
 * A summit from the camera's point of view, in the stage's CSS pixels with y pointing down.
 *
 * `ahead`: in front of the camera, projected to (x, y), which may lie far outside the stage.
 * `behind`: at or behind the camera plane, where a projection would mirror it; only the way to
 * turn toward it is known, as a unit vector on the screen.
 * `unknown`: no direction can be trusted, as for a summit straight behind the camera.
 */
export type SummitSighting =
	| { kind: 'ahead'; x: number; y: number }
	| { kind: 'behind'; dx: number; dy: number }
	| { kind: 'unknown' };

/** What stands between the camera and a summit that lies in the frame: the globe's curve or terrain. */
export type Concealment = 'horizon' | 'terrain';

export interface NearbySighting {
	slug: string;
	sighting: SummitSighting;
	/**
	 * Set when the summit is in or near the frame and cannot be seen from the camera. Left out for
	 * summits far off screen, where it is not worked out, and for those in plain view.
	 */
	concealed?: Concealment;
	/**
	 * Set with `concealed`: the sighting of the summit's horizontal bearing from the camera, read
	 * by `sightBearing`. It says which way the summit lies, not where it would appear.
	 */
	bearing?: SummitSighting;
}

/** One reading of every requested summit, taken against the stage size it was projected onto. */
export interface SummitSightings {
	viewport: StageSize;
	presented: SummitSighting;
	nearby: readonly NearbySighting[];
}

/** A point relative to the camera, in meters along its right, up and viewing directions. */
export interface CameraSpacePoint {
	right: number;
	up: number;
	forward: number;
}

/** The tangents of half the horizontal and half the vertical field of view. */
export interface Lens {
	tanHalfWidth: number;
	tanHalfHeight: number;
}

/** Where a summit lies with respect to what the stage shows. */
export type ViewPlacement =
	{ kind: 'in-view' } | { kind: 'offscreen'; dx: number; dy: number } | { kind: 'unknown' };

export const UNKNOWN_SIGHTING: SummitSighting = { kind: 'unknown' };

/**
 * A summit already pointed at off screen must come this far inside the stage before it counts as
 * in view, so one hovering on the edge does not make its indicator blink.
 */
export const VIEW_HYSTERESIS_PX = 24;

/** Closer than this the camera is at the summit, and the direction to it means nothing. */
const MIN_DISTANCE_METERS = 1;

/**
 * Below this share of the distance, the summit is too close to the camera plane to project
 * reliably; its direction on screen is the same either way, so it is read as `behind`.
 */
const MIN_FORWARD_SHARE = 1e-3;

/**
 * A summit within about 3° of straight behind the camera has no stable way to turn: a hair of
 * movement swings it from one edge to the opposite one. sin(3°).
 */
const MIN_SIDEWAYS_SHARE = 0.0523;

/**
 * Projects a point given relative to the camera, as Cesium's perspective frustum does: the image
 * plane is at unit distance and spans ±tanHalfWidth across and ±tanHalfHeight up.
 *
 * In front of the camera the point is projected. At or behind the camera plane a projection
 * would mirror it to the wrong side, so only its direction is kept: the way the camera would turn
 * to face it, which is the projection's direction in the limit as the point crosses the plane, so
 * nothing jumps when it does. A point the camera stands on, one straight behind it, and any
 * invalid input give `unknown`.
 */
export function sightSummit(
	point: CameraSpacePoint,
	lens: Lens,
	viewport: StageSize
): SummitSighting {
	const { right, up, forward } = point;
	const { tanHalfWidth, tanHalfHeight } = lens;
	const { width, height } = viewport;
	if (
		![right, up, forward].every(Number.isFinite) ||
		!(tanHalfWidth > 0) ||
		!(tanHalfHeight > 0) ||
		!(width > 0) ||
		!(height > 0)
	) {
		return UNKNOWN_SIGHTING;
	}

	const distance = Math.hypot(right, up, forward);
	if (!(distance >= MIN_DISTANCE_METERS)) {
		return UNKNOWN_SIGHTING;
	}

	// On the image plane scaled by depth, so the screen axes have equal weight at the frame's edge.
	const across = right / tanHalfWidth;
	const upward = up / tanHalfHeight;

	if (forward > distance * MIN_FORWARD_SHARE) {
		const x = (width / 2) * (1 + across / forward);
		const y = (height / 2) * (1 - upward / forward);

		return Number.isFinite(x) && Number.isFinite(y) ? { kind: 'ahead', x, y } : UNKNOWN_SIGHTING;
	}

	if (Math.hypot(right, up) < distance * MIN_SIDEWAYS_SHARE) {
		return UNKNOWN_SIGHTING;
	}

	// In pixels, as a projection's offset from the centre is, so the two agree at the plane.
	const dx = across * (width / 2);
	const dy = -upward * (height / 2);
	const length = Math.hypot(dx, dy);

	return { kind: 'behind', dx: dx / length, dy: dy / length };
}

/**
 * Below this share of the distance, the summit is within about 3° of straight above or below the
 * camera and has no horizontal bearing worth showing. sin(3°).
 */
const MIN_LEVEL_SHARE = 0.0523;

/**
 * The summit's horizontal bearing from the camera, as a sighting of the level direction toward it:
 * the way to the summit with its rise or fall taken out, at the camera's eye level. `localUp` is
 * the camera's geodetic up, given in the same camera axes as `point`.
 *
 * Projected, it lands where the level line in the summit's bearing meets the stage: on or just
 * above the skyline, in the column the summit lies behind, never on terrain that only happens to
 * be in front of it. It is a direction rather than a place, so a summit beyond the horizon or
 * behind a ridge keeps a trustworthy bearing while it cannot be seen. Using the camera's own axes
 * accounts for heading, pitch and roll alike, with no heading to go singular when the camera looks
 * straight down; a level direction behind the camera plane, as when it looks steeply down, comes
 * back `behind`. A summit nearly straight above or below the camera, and invalid input, give
 * `unknown`.
 */
export function sightBearing(
	point: CameraSpacePoint,
	localUp: CameraSpacePoint,
	lens: Lens,
	viewport: StageSize
): SummitSighting {
	const upLength = Math.hypot(localUp.right, localUp.up, localUp.forward);
	const distance = Math.hypot(point.right, point.up, point.forward);
	if (!(upLength > 0) || !Number.isFinite(upLength) || !(distance >= MIN_DISTANCE_METERS)) {
		return UNKNOWN_SIGHTING;
	}

	const rise =
		(point.right * localUp.right + point.up * localUp.up + point.forward * localUp.forward) /
		(upLength * upLength);
	const level = {
		right: point.right - rise * localUp.right,
		up: point.up - rise * localUp.up,
		forward: point.forward - rise * localUp.forward
	};
	if (!(Math.hypot(level.right, level.up, level.forward) >= distance * MIN_LEVEL_SHARE)) {
		return UNKNOWN_SIGHTING;
	}

	return sightSummit(level, lens, viewport);
}

/**
 * Whether a sighting is in view or off screen, and in which direction from the stage's centre.
 * A summit is in view when it projects inside the stage; one that was off screen must come
 * `VIEW_HYSTERESIS_PX` inside first. Whether the globe hides it does not matter: a summit beyond
 * the horizon still lies in its direction, and pointing to an edge only makes sense while that
 * direction is outside the frame.
 */
export function placeInView(
	sighting: SummitSighting,
	viewport: StageSize,
	wasOffscreen: boolean
): ViewPlacement {
	const { width, height } = viewport;
	if (sighting.kind === 'unknown' || !(width > 0) || !(height > 0)) {
		return { kind: 'unknown' };
	}
	if (sighting.kind === 'behind') {
		return { kind: 'offscreen', dx: sighting.dx, dy: sighting.dy };
	}

	const margin = wasOffscreen ? Math.min(VIEW_HYSTERESIS_PX, width / 2, height / 2) : 0;
	const { x, y } = sighting;
	if (x >= margin && x <= width - margin && y >= margin && y <= height - margin) {
		return { kind: 'in-view' };
	}

	const dx = x - width / 2;
	const dy = y - height / 2;
	const length = Math.hypot(dx, dy);
	if (!(length > 0) || !Number.isFinite(length)) {
		return { kind: 'unknown' };
	}

	return { kind: 'offscreen', dx: dx / length, dy: dy / length };
}

/**
 * Whether a sighting projects inside the stage, or within the hysteresis margin of it: the summits
 * whose concealment matters, since only one in the frame is drawn where it stands.
 */
export function nearFrame(sighting: SummitSighting, viewport: StageSize): boolean {
	if (sighting.kind !== 'ahead') {
		return false;
	}
	const { width, height } = viewport;

	return (
		sighting.x >= -VIEW_HYSTERESIS_PX &&
		sighting.x <= width + VIEW_HYSTERESIS_PX &&
		sighting.y >= -VIEW_HYSTERESIS_PX &&
		sighting.y <= height + VIEW_HYSTERESIS_PX
	);
}

export function sameSightedSummits(
	a: readonly SightedSummit[],
	b: readonly SightedSummit[]
): boolean {
	return (
		a === b ||
		(a.length === b.length &&
			a.every((summit, index) => {
				const other = b[index]!;
				return (
					summit.slug === other.slug &&
					summit.latitude === other.latitude &&
					summit.longitude === other.longitude &&
					summit.elevationMeters === other.elevationMeters
				);
			}))
	);
}
