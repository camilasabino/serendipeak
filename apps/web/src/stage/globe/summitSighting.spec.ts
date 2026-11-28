import { describe, expect, it } from 'vitest';
import type { StageSize } from './stageFrame';
import {
	VIEW_HYSTERESIS_PX,
	nearFrame,
	placeInView,
	sameSightedSummits,
	sightBearing,
	sightSummit,
	type CameraSpacePoint,
	type Lens,
	type SummitSighting
} from './summitSighting';

const STAGE: StageSize = { width: 800, height: 600 };

/** Cesium's default 60° field of view, spread over the wider side as its frustum does. */
function lensFor({ width, height }: StageSize): Lens {
	const aspect = width / height;
	const tanHalfHeight = aspect > 1 ? Math.tan(Math.PI / 6) / aspect : Math.tan(Math.PI / 6);

	return { tanHalfHeight, tanHalfWidth: tanHalfHeight * aspect };
}

type Vector = [number, number, number];

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const dot = (a: Vector, b: Vector) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const minus = (a: Vector, b: Vector): Vector => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vector, b: Vector): Vector => [
	a[1] * b[2] - a[2] * b[1],
	a[2] * b[0] - a[0] * b[2],
	a[0] * b[1] - a[1] * b[0]
];
const along = (axes: Vector[], weights: number[]): Vector =>
	[0, 1, 2].map((i) => axes.reduce((sum, axis, k) => sum + axis[i]! * weights[k]!, 0)) as Vector;

const EARTH_RADIUS = 6_371_000;

/** A spherical Earth is enough here: the code under test only sees camera-space vectors. */
function ecef(latitude: number, longitude: number, height: number): Vector {
	const r = EARTH_RADIUS + height;
	const φ = radians(latitude);
	const λ = radians(longitude);

	return [r * Math.cos(φ) * Math.cos(λ), r * Math.cos(φ) * Math.sin(λ), r * Math.sin(φ)];
}

interface Pose {
	latitude: number;
	longitude: number;
	height: number;
	headingDegrees: number;
	pitchDegrees: number;
	rollDegrees?: number;
}

/** A camera placed like Cesium's: heading clockwise from north, pitch below the horizon negative. */
function cameraSpace(pose: Pose, target: Vector): CameraSpacePoint {
	const φ = radians(pose.latitude);
	const λ = radians(pose.longitude);
	const east: Vector = [-Math.sin(λ), Math.cos(λ), 0];
	const north: Vector = [-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ)];
	const up: Vector = [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
	const h = radians(pose.headingDegrees);
	const p = radians(pose.pitchDegrees);
	const r = radians(pose.rollDegrees ?? 0);

	const forward = along(
		[east, north, up],
		[Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p)]
	);
	const level = along([east, north], [Math.cos(h), -Math.sin(h)]);
	const lift = cross(level, forward);
	const right = along([level, lift], [Math.cos(r), -Math.sin(r)]);
	const cameraUp = along([level, lift], [Math.sin(r), Math.cos(r)]);
	const offset = minus(target, ecef(pose.latitude, pose.longitude, pose.height));

	return { right: dot(offset, right), up: dot(offset, cameraUp), forward: dot(offset, forward) };
}

function sight(pose: Pose, target: Vector, stage = STAGE): SummitSighting {
	return sightSummit(cameraSpace(pose, target), lensFor(stage), stage);
}

function direction(sighting: SummitSighting, stage = STAGE, wasOffscreen = false) {
	return placeInView(sighting, stage, wasOffscreen);
}

// About 3 km above a summit at the equator, looking north, slightly down.
const LOOKING_NORTH: Pose = {
	latitude: 0,
	longitude: 0,
	height: 3000,
	headingDegrees: 0,
	pitchDegrees: -10
};
const KM = 1 / 111.19;

describe('sightSummit', () => {
	it('projects a point straight ahead onto the stage centre', () => {
		expect(sightSummit({ right: 0, up: 0, forward: 1000 }, lensFor(STAGE), STAGE)).toEqual({
			kind: 'ahead',
			x: 400,
			y: 300
		});
	});

	it('projects onto the frame edge at the edge of the field of view, as the frustum does', () => {
		const lens = lensFor(STAGE);
		const edge = sightSummit(
			{ right: lens.tanHalfWidth * 1000, up: 0, forward: 1000 },
			lens,
			STAGE
		);
		const top = sightSummit(
			{ right: 0, up: lens.tanHalfHeight * 1000, forward: 1000 },
			lens,
			STAGE
		);

		expect(edge).toEqual({ kind: 'ahead', x: expect.closeTo(800, 6), y: 300 });
		expect(top).toEqual({ kind: 'ahead', x: 400, y: expect.closeTo(0, 6) });
	});

	it('depends on the direction only, not on how far along it the summit lies', () => {
		const near = sightSummit({ right: 30, up: -20, forward: 100 }, lensFor(STAGE), STAGE);
		const far = sightSummit(
			{ right: 30_000, up: -20_000, forward: 100_000 },
			lensFor(STAGE),
			STAGE
		);

		expect(far).toEqual({
			kind: 'ahead',
			x: expect.closeTo((near as { x: number }).x, 9),
			y: expect.closeTo((near as { y: number }).y, 9)
		});
	});

	it.each([
		['east', 0, 50 * KM, 'right'],
		['west', 0, -50 * KM, 'left']
	])(
		'puts a summit to the %s of a camera looking north off the %s side',
		(_name, lat, lon, side) => {
			const placement = direction(sight(LOOKING_NORTH, ecef(lat, lon, 2000)));

			expect(placement.kind).toBe('offscreen');
			if (placement.kind === 'offscreen') {
				expect(Math.sign(placement.dx)).toBe(side === 'right' ? 1 : -1);
				expect(Math.abs(placement.dx)).toBeGreaterThan(0.99);
			}
		}
	);

	it('puts a summit below a camera looking at the sky off the bottom, and one above a camera looking down off the top', () => {
		const below = direction(sight({ ...LOOKING_NORTH, pitchDegrees: 45 }, ecef(20 * KM, 0, 0)));
		const above = direction(
			sight({ ...LOOKING_NORTH, height: 20_000, pitchDegrees: -85 }, ecef(200 * KM, 0, 3000))
		);

		expect(below).toEqual({
			kind: 'offscreen',
			dx: expect.closeTo(0, 6),
			dy: expect.closeTo(1, 6)
		});
		expect(above).toEqual({
			kind: 'offscreen',
			dx: expect.closeTo(0, 6),
			dy: expect.closeTo(-1, 6)
		});
	});

	it('follows the camera as it turns: the same summit is ahead, then to the left, then to the right', () => {
		const summit = ecef(40 * KM, 40 * KM, 2500);

		const facing = direction(sight({ ...LOOKING_NORTH, headingDegrees: 45 }, summit));
		const turnedRight = direction(sight({ ...LOOKING_NORTH, headingDegrees: 135 }, summit));
		const turnedLeft = direction(sight({ ...LOOKING_NORTH, headingDegrees: -45 }, summit));

		expect(facing).toEqual({ kind: 'in-view' });
		expect(turnedRight.kind === 'offscreen' && turnedRight.dx < 0).toBe(true);
		expect(turnedLeft.kind === 'offscreen' && turnedLeft.dx > 0).toBe(true);
	});

	it('turns with a rolled camera: a summit to the right reaches the top or bottom edge', () => {
		const summit = ecef(0, 50 * KM, 2000);

		const rolled = direction(sight({ ...LOOKING_NORTH, rollDegrees: 90 }, summit));

		expect(rolled.kind).toBe('offscreen');
		if (rolled.kind === 'offscreen') {
			expect(Math.abs(rolled.dy)).toBeGreaterThan(0.99);
		}
	});

	it('reads a summit behind the camera as a way to turn, never as a mirrored projection', () => {
		// Behind and to the right: its mirrored projection would land on the left half of the stage.
		const sighting = sight(LOOKING_NORTH, ecef(-30 * KM, 20 * KM, 2000));

		expect(sighting.kind).toBe('behind');
		if (sighting.kind === 'behind') {
			expect(sighting.dx).toBeGreaterThan(0);
			expect(Math.hypot(sighting.dx, sighting.dy)).toBeCloseTo(1, 9);
		}
		expect(direction(sighting)).toMatchObject({ kind: 'offscreen' });
	});

	it('keeps the direction steady as a summit crosses the camera plane', () => {
		const lens = lensFor(STAGE);
		const ahead = direction(sightSummit({ right: 1000, up: 400, forward: 2 }, lens, STAGE));
		const behind = direction(sightSummit({ right: 1000, up: 400, forward: -2 }, lens, STAGE));

		expect(ahead.kind).toBe('offscreen');
		expect(behind.kind).toBe('offscreen');
		if (ahead.kind === 'offscreen' && behind.kind === 'offscreen') {
			expect(behind.dx).toBeCloseTo(ahead.dx, 3);
			expect(behind.dy).toBeCloseTo(ahead.dy, 3);
		}
	});

	it('gives no direction for a summit straight behind the camera', () => {
		expect(sightSummit({ right: 0, up: 0, forward: -5000 }, lensFor(STAGE), STAGE)).toEqual({
			kind: 'unknown'
		});
		expect(sightSummit({ right: 50, up: 30, forward: -5000 }, lensFor(STAGE), STAGE)).toEqual({
			kind: 'unknown'
		});
	});

	it.each<[string, CameraSpacePoint, Lens, StageSize]>([
		['a camera on the summit', { right: 0.2, up: 0.1, forward: 0.3 }, lensFor(STAGE), STAGE],
		['a non-finite point', { right: Number.NaN, up: 0, forward: 10 }, lensFor(STAGE), STAGE],
		[
			'an unmeasured stage',
			{ right: 0, up: 0, forward: 10 },
			lensFor(STAGE),
			{ width: 0, height: 0 }
		],
		[
			'a degenerate lens',
			{ right: 0, up: 0, forward: 10 },
			{ tanHalfWidth: 0, tanHalfHeight: 0.5 },
			STAGE
		]
	])('gives no direction for %s', (_name, point, lens, stage) => {
		expect(sightSummit(point, lens, stage)).toEqual({ kind: 'unknown' });
	});

	it('has no seam at the antimeridian: east and west keep their sides across it', () => {
		const camera: Pose = { ...LOOKING_NORTH, longitude: 179.98 };

		const east = direction(sight(camera, ecef(0, -179.6, 2000)));
		const west = direction(sight(camera, ecef(0, 179.6, 2000)));
		const ahead = direction(sight(camera, ecef(30 * KM, -179.99, 2000)));

		expect(east.kind === 'offscreen' && east.dx > 0.99).toBe(true);
		expect(west.kind === 'offscreen' && west.dx < -0.99).toBe(true);
		expect(ahead).toEqual({ kind: 'in-view' });
	});
});

/** The point `distanceKm` along the great circle leaving (latitude, longitude) at `bearingDegrees`. */
function destination(
	latitude: number,
	longitude: number,
	bearingDegrees: number,
	distanceKm: number,
	height: number
): Vector {
	const δ = (distanceKm * 1000) / EARTH_RADIUS;
	const φ1 = radians(latitude);
	const θ = radians(bearingDegrees);
	const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
	const λ2 =
		radians(longitude) +
		Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));

	return ecef((φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI, height);
}

function sightLevel(pose: Pose, target: Vector, stage = STAGE): SummitSighting {
	const up = cameraSpace(pose, ecef(pose.latitude, pose.longitude, pose.height + 1));

	return sightBearing(cameraSpace(pose, target), up, lensFor(stage), stage);
}

describe('sightBearing', () => {
	// Aneto's canonical view: about 3.9 km up, looking north-east and a little down. Mont Blanc
	// lies 615 km away at a bearing of 52°, far beyond the horizon (about 470 km for the two).
	const ANETO_VIEW: Pose = {
		latitude: 42.6,
		longitude: 0.62,
		height: 3900,
		headingDegrees: 38.3,
		pitchDegrees: -6
	};
	const WIDE: StageSize = { width: 1440, height: 900 };
	const MONT_BLANC = destination(42.6, 0.62, 52.1, 615, 4807);

	it('draws a summit beyond the horizon in the column of its bearing, at eye level, not where it projects', () => {
		const lens = lensFor(WIDE);
		const turn = radians(52.1 - 38.3);
		const pitch = radians(-6);
		const expectedX = (WIDE.width / 2) * (1 + Math.tan(turn) / Math.cos(pitch) / lens.tanHalfWidth);

		const level = sightLevel(ANETO_VIEW, MONT_BLANC, WIDE);
		const projected = sight(ANETO_VIEW, MONT_BLANC, WIDE);

		expect(level).toEqual({
			kind: 'ahead',
			x: expect.closeTo(expectedX, 0),
			y: expect.any(Number)
		});
		expect(projected.kind).toBe('ahead');
		if (level.kind === 'ahead' && projected.kind === 'ahead') {
			// Eye level is above the camera's centre line, which points 6° down, and the summit
			// projects lower still, onto the nearer terrain it lies behind.
			expect(level.y).toBeLessThan(WIDE.height / 2);
			expect(projected.y).toBeGreaterThan(level.y + 20);
		}
	});

	it('depends on the bearing alone, not on how far along it the summit lies or how high it stands', () => {
		const near = sightLevel(ANETO_VIEW, destination(42.6, 0.62, 52.1, 80, 1200), WIDE);
		const far = sightLevel(ANETO_VIEW, destination(42.6, 0.62, 52.1, 900, 8000), WIDE);

		expect(near.kind === 'ahead' && far.kind === 'ahead').toBe(true);
		if (near.kind === 'ahead' && far.kind === 'ahead') {
			expect(far.x).toBeCloseTo(near.x, 6);
			expect(far.y).toBeCloseTo(near.y, 6);
		}
	});

	it('moves with the camera’s heading: turning right brings the bearing toward the centre, then past it', () => {
		const xAt = (headingDegrees: number) => {
			const level = sightLevel({ ...ANETO_VIEW, headingDegrees }, MONT_BLANC, WIDE);
			return level.kind === 'ahead' ? level.x : Number.NaN;
		};

		expect(xAt(38.3)).toBeGreaterThan(WIDE.width / 2);
		expect(xAt(52.1)).toBeCloseTo(WIDE.width / 2, 6);
		expect(xAt(70)).toBeLessThan(WIDE.width / 2);
	});

	it('lays every bearing on the horizon line, tilted with a rolled camera', () => {
		const rolled: Pose = { ...ANETO_VIEW, pitchDegrees: 0, rollDegrees: 12 };
		const points = [30, 45, 60].map((bearing) =>
			sightLevel(rolled, destination(42.6, 0.62, bearing, 600, 4000), WIDE)
		);

		expect(points.every((point) => point.kind === 'ahead')).toBe(true);
		type Point = Extract<SummitSighting, { kind: 'ahead' }>;
		const [a, b, c] = points as [Point, Point, Point];
		const slope = (from: Point, to: Point) => (to.y - from.y) / (to.x - from.x);
		expect(slope(a, b)).toBeCloseTo(slope(b, c), 6);
		expect(Math.abs(Math.atan(slope(a, c)) * (180 / Math.PI))).toBeCloseTo(12, 6);
	});

	it('points the way to turn for a bearing behind a camera that looks straight down', () => {
		const overhead: Pose = { ...ANETO_VIEW, pitchDegrees: -90, headingDegrees: 0 };

		const east = sightLevel(overhead, destination(42.6, 0.62, 90, 600, 4000), WIDE);
		const north = sightLevel(overhead, destination(42.6, 0.62, 0, 600, 4000), WIDE);

		expect(east).toEqual({ kind: 'behind', dx: expect.closeTo(1, 3), dy: expect.closeTo(0, 3) });
		expect(north).toEqual({ kind: 'behind', dx: expect.closeTo(0, 3), dy: expect.closeTo(-1, 3) });
	});

	it('reads a bearing behind a level camera as a way to turn, and straight behind as unknown', () => {
		const level: Pose = { ...ANETO_VIEW, pitchDegrees: 0 };

		const behindLeft = sightLevel(level, destination(42.6, 0.62, 38.3 + 150, 600, 4000), WIDE);
		const straightBehind = sightLevel(level, destination(42.6, 0.62, 38.3 + 180, 600, 4000), WIDE);

		expect(behindLeft.kind === 'behind' && behindLeft.dx > 0.9).toBe(true);
		expect(straightBehind).toEqual({ kind: 'unknown' });
	});

	it('gives no bearing for a summit nearly straight below the camera, or for invalid input', () => {
		const below = ecef(ANETO_VIEW.latitude + 0.05 * KM, ANETO_VIEW.longitude, 0);
		const up = cameraSpace(ANETO_VIEW, ecef(ANETO_VIEW.latitude, ANETO_VIEW.longitude, 3901));

		expect(sightLevel(ANETO_VIEW, below, WIDE)).toEqual({ kind: 'unknown' });
		expect(
			sightBearing(
				cameraSpace(ANETO_VIEW, MONT_BLANC),
				{ right: 0, up: 0, forward: 0 },
				lensFor(WIDE),
				WIDE
			)
		).toEqual({ kind: 'unknown' });
		expect(sightBearing({ right: Number.NaN, up: 0, forward: 1 }, up, lensFor(WIDE), WIDE)).toEqual(
			{ kind: 'unknown' }
		);
	});

	it('has no seam at the antimeridian', () => {
		const camera: Pose = {
			...LOOKING_NORTH,
			longitude: 179.9,
			headingDegrees: 90,
			pitchDegrees: -5
		};

		const across = sightLevel(camera, destination(0, 179.9, 90, 700, 4000));

		expect(across).toEqual({
			kind: 'ahead',
			x: expect.closeTo(STAGE.width / 2, 6),
			y: expect.any(Number)
		});
	});
});

describe('placeInView and the globe', () => {
	// From 7 km up, a summit 900 km away at 6 km lies well past the horizon (about 575 km).
	const HIGH: Pose = {
		latitude: -32.65,
		longitude: -70,
		height: 7000,
		headingDegrees: 0,
		pitchDegrees: -15
	};
	const BEYOND_HORIZON = ecef(-32.65 + 900 * KM, -70, 6000);

	it('reads a summit hidden by the globe but inside the frame as in view: there is no edge it lies past', () => {
		expect(direction(sight(HIGH, BEYOND_HORIZON))).toEqual({ kind: 'in-view' });
	});

	it('still points to a summit beyond the horizon once its direction leaves the frame', () => {
		const placement = direction(sight({ ...HIGH, headingDegrees: 90 }, BEYOND_HORIZON));

		expect(placement.kind === 'offscreen' && placement.dx < -0.9).toBe(true);
	});
});

describe('placeInView', () => {
	const at = (x: number, y: number): SummitSighting => ({ kind: 'ahead', x, y });

	it('is in view anywhere inside the stage, edges included', () => {
		for (const [x, y] of [
			[400, 300],
			[0, 0],
			[800, 600],
			[799, 1]
		] as const) {
			expect(placeInView(at(x, y), STAGE, false)).toEqual({ kind: 'in-view' });
		}
	});

	it('points from the stage centre toward a summit projected outside it', () => {
		expect(placeInView(at(1200, 300), STAGE, false)).toEqual({ kind: 'offscreen', dx: 1, dy: 0 });
		expect(placeInView(at(400, -100), STAGE, false)).toEqual({ kind: 'offscreen', dx: 0, dy: -1 });
	});

	it('keeps an indicator until its summit is a margin inside, so the edge does not blink', () => {
		const justInside = at(STAGE.width - VIEW_HYSTERESIS_PX / 2, 300);
		const wellInside = at(STAGE.width - VIEW_HYSTERESIS_PX - 1, 300);

		expect(placeInView(justInside, STAGE, false)).toEqual({ kind: 'in-view' });
		expect(placeInView(justInside, STAGE, true)).toEqual({ kind: 'offscreen', dx: 1, dy: 0 });
		expect(placeInView(wellInside, STAGE, true)).toEqual({ kind: 'in-view' });
	});

	it('passes a summit behind the camera through as off screen, and an unknown one as unknown', () => {
		expect(placeInView({ kind: 'behind', dx: 0.6, dy: -0.8 }, STAGE, false)).toEqual({
			kind: 'offscreen',
			dx: 0.6,
			dy: -0.8
		});
		expect(placeInView({ kind: 'unknown' }, STAGE, true)).toEqual({ kind: 'unknown' });
		expect(placeInView(at(10, 10), { width: 0, height: 0 }, false)).toEqual({ kind: 'unknown' });
	});
});

describe('nearFrame', () => {
	it('holds for a summit inside the stage or within the hysteresis margin of it, and only then', () => {
		const at = (x: number, y: number): SummitSighting => ({ kind: 'ahead', x, y });

		expect(nearFrame(at(400, 300), STAGE)).toBe(true);
		expect(nearFrame(at(STAGE.width + VIEW_HYSTERESIS_PX - 1, 300), STAGE)).toBe(true);
		expect(nearFrame(at(-VIEW_HYSTERESIS_PX - 1, 300), STAGE)).toBe(false);
		expect(nearFrame(at(400, STAGE.height + 500), STAGE)).toBe(false);
		expect(nearFrame({ kind: 'behind', dx: 1, dy: 0 }, STAGE)).toBe(false);
		expect(nearFrame({ kind: 'unknown' }, STAGE)).toBe(false);
	});
});

describe('sameSightedSummits', () => {
	const summit = { slug: 'a', latitude: 1, longitude: 2, elevationMeters: 3 };

	it('compares content, in order', () => {
		expect(sameSightedSummits([summit], [{ ...summit }])).toBe(true);
		expect(sameSightedSummits([summit], [{ ...summit, longitude: 2.5 }])).toBe(false);
		expect(
			sameSightedSummits([summit, { ...summit, slug: 'b' }], [{ ...summit, slug: 'b' }, summit])
		).toBe(false);
	});
});
