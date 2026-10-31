import { describe, expect, it } from 'vitest';
import {
	CESIUM_DEFAULT_FOV_RADIANS,
	cameraOffsetFromPose,
	cesiumVerticalFovRadians,
	lookAxesForFraming,
	projectSummitNormalized
} from './framing';
import { stageAspectScale } from './terrainCamera';

const DESKTOP = { width: 1626, height: 1053 };
const NARROW = { width: 560, height: 762 };
const WIDE = { width: 895, height: 468 };

function pixels(
	actual: { x: number; y: number },
	expected: { x: number; y: number },
	stage: { width: number; height: number }
) {
	return {
		x: Math.abs(actual.x - expected.x) * (stage.width / 2),
		y: Math.abs(actual.y - expected.y) * (stage.height / 2)
	};
}

function place(
	headingDegrees: number,
	pitchDegrees: number,
	rangeMeters: number,
	framing: { x: number; y: number },
	stage: { width: number; height: number },
	fovRadians = CESIUM_DEFAULT_FOV_RADIANS
) {
	const aspect = stage.width / stage.height;
	const fovy = cesiumVerticalFovRadians(fovRadians, aspect);
	const position = cameraOffsetFromPose(headingDegrees, pitchDegrees, rangeMeters);
	const axes = lookAxesForFraming(position, framing, fovy, aspect);
	const projected = axes ? projectSummitNormalized(position, axes, fovy, aspect) : undefined;
	return { position, axes, projected, fovy, aspect };
}

describe('centered framing', () => {
	it('puts the summit on the optical center for an explicit zero and for a missing value', () => {
		const explicit = place(140, -18, 12_000, { x: 0, y: 0 }, DESKTOP);
		const missing = place(140, -18, 12_000, { x: 0, y: 0 }, DESKTOP);

		expect(explicit.projected).toBeDefined();
		expect(missing.projected).toEqual(explicit.projected);
		expect(explicit.projected?.x).toBeCloseTo(0, 8);
		expect(explicit.projected?.y).toBeCloseTo(0, 8);
		const error = pixels(explicit.projected ?? { x: 1, y: 1 }, { x: 0, y: 0 }, DESKTOP);
		expect(error.x).toBeLessThanOrEqual(1);
		expect(error.y).toBeLessThanOrEqual(1);
	});
});

describe('off-center framing', () => {
	it('places a negative x left of center', () => {
		const framing = { x: -0.2, y: 0 };
		const placed = place(200, -16, 9_000, framing, DESKTOP);

		expect(placed.projected?.x).toBeCloseTo(-0.2, 6);
		expect(placed.projected?.y).toBeCloseTo(0, 6);
		expect((placed.projected?.x ?? 0) * (DESKTOP.width / 2)).toBeLessThan(0);
	});

	it('places a positive y toward the top', () => {
		const framing = { x: 0, y: 0.18 };
		const placed = place(80, -22, 11_000, framing, DESKTOP);

		expect(placed.projected?.x).toBeCloseTo(0, 6);
		expect(placed.projected?.y).toBeCloseTo(0.18, 6);
		expect(placed.projected?.y ?? 0).toBeGreaterThan(0);
	});

	it('places a combined offset at the requested screen coordinate', () => {
		const framing = { x: -0.12, y: 0.18 };
		const placed = place(347.62, -16.84, 10_519, framing, DESKTOP);
		const error = pixels(placed.projected ?? { x: 0, y: 0 }, framing, DESKTOP);

		expect(error.x).toBeLessThanOrEqual(1);
		expect(error.y).toBeLessThanOrEqual(1);
		expect(placed.projected?.x).toBeCloseTo(framing.x, 6);
		expect(placed.projected?.y).toBeCloseTo(framing.y, 6);
	});
});

describe('framing leaves the camera position alone', () => {
	it('uses the same summit offset for a centered pose and a framed pose', () => {
		const heading = 255;
		const pitch = -16;
		const range = 7_800 * stageAspectScale(DESKTOP.width, DESKTOP.height);
		const centered = place(heading, pitch, range, { x: 0, y: 0 }, DESKTOP);
		const framed = place(heading, pitch, range, { x: 0.24, y: -0.31 }, DESKTOP);

		expect(framed.position).toEqual(centered.position);
		expect(framed.projected?.x).not.toBeCloseTo(0, 2);
		expect(framed.axes?.direction).not.toEqual(centered.axes?.direction);
	});
});

describe('responsive framing', () => {
	it('keeps the normalized summit and scales range once', () => {
		const heading = 170;
		const pitch = -18;
		const base = 7_000;
		const framing = { x: -0.12, y: 0.18 };
		const narrowRange = base * stageAspectScale(NARROW.width, NARROW.height);
		const wideRange = base * stageAspectScale(WIDE.width, WIDE.height);
		const narrow = place(heading, pitch, narrowRange, framing, NARROW);
		const wide = place(heading, pitch, wideRange, framing, WIDE);

		expect(stageAspectScale(NARROW.width, NARROW.height)).toBe(1.25);
		expect(stageAspectScale(WIDE.width, WIDE.height)).toBe(0.85);
		expect(narrowRange).toBe(base * 1.25);
		expect(wideRange).toBe(base * 0.85);
		expect(narrowRange).not.toBeCloseTo(base * 1.25 * 1.25, 3);
		expect(narrow.projected?.x).toBeCloseTo(framing.x, 5);
		expect(narrow.projected?.y).toBeCloseTo(framing.y, 5);
		expect(wide.projected?.x).toBeCloseTo(framing.x, 5);
		expect(wide.projected?.y).toBeCloseTo(framing.y, 5);
		expect(Math.hypot(narrow.position.x, narrow.position.y, narrow.position.z)).toBeCloseTo(
			narrowRange,
			4
		);
		expect(Math.hypot(wide.position.x, wide.position.y, wide.position.z)).toBeCloseTo(wideRange, 4);
	});
});

describe('arbitrary manual camera round trip', () => {
	it('reproduces a look that does not pass through the summit', () => {
		const width = DESKTOP.width;
		const height = DESKTOP.height;
		const aspect = width / height;
		const fovy = cesiumVerticalFovRadians(CESIUM_DEFAULT_FOV_RADIANS, aspect);
		const position = { x: 900, y: 5_800, z: 3_900 };
		const towardSummit = unit(-position.x, -position.y, -position.z);
		const turned = rotateAround(towardSummit, unit(-towardSummit.y, towardSummit.x, 0), 11);
		const look = rotateAround(turned, { x: 0, y: 0, z: 1 }, -7);
		const manualAxes = axesFromForward(look);
		const manual = projectSummitNormalized(position, manualAxes, fovy, aspect);
		const centered = projectSummitNormalized(position, axesFromForward(towardSummit), fovy, aspect);

		expect(manual).toBeDefined();
		expect(Math.hypot(centered?.x ?? 1, centered?.y ?? 1)).toBeLessThan(1e-8);
		expect(Math.hypot(manual?.x ?? 0, manual?.y ?? 0)).toBeGreaterThan(0.15);

		const heading = lookHeading(position);
		const pitch = lookPitch(position);
		const range = Math.hypot(position.x, position.y, position.z);
		const rebuilt = cameraOffsetFromPose(heading, pitch, range);
		const replay = lookAxesForFraming(rebuilt, manual ?? { x: 0, y: 0 }, fovy, aspect);
		const projected = replay ? projectSummitNormalized(rebuilt, replay, fovy, aspect) : undefined;
		const error = pixels(projected ?? { x: 2, y: 2 }, manual ?? { x: 0, y: 0 }, DESKTOP);

		expect(
			Math.hypot(rebuilt.x - position.x, rebuilt.y - position.y, rebuilt.z - position.z)
		).toBeLessThan(1e-6);
		expect(error.x).toBeLessThanOrEqual(1);
		expect(error.y).toBeLessThanOrEqual(1);
		expect(replay?.direction.z).toBeCloseTo(look.z, 5);
	});
});

function unit(x: number, y: number, z: number) {
	const length = Math.hypot(x, y, z);
	return { x: x / length, y: y / length, z: z / length };
}

function dot(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
	return a.x * b.x + a.y * b.y + a.z * b.z;
}

function cross(a: { x: number; y: number; z: number }, b: { x: number; y: number; z: number }) {
	return {
		x: a.y * b.z - a.z * b.y,
		y: a.z * b.x - a.x * b.z,
		z: a.x * b.y - a.y * b.x
	};
}

function rotateAround(
	vector: { x: number; y: number; z: number },
	axis: { x: number; y: number; z: number },
	degrees: number
) {
	const a = unit(axis.x, axis.y, axis.z);
	const radians = (degrees * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	const turned = cross(a, vector);
	const along = dot(a, vector);
	return unit(
		vector.x * cosine + turned.x * sine + a.x * along * (1 - cosine),
		vector.y * cosine + turned.y * sine + a.y * along * (1 - cosine),
		vector.z * cosine + turned.z * sine + a.z * along * (1 - cosine)
	);
}

function axesFromForward(forward: { x: number; y: number; z: number }) {
	const right = unit(
		forward.y * 1 - forward.z * 0,
		forward.z * 0 - forward.x * 1,
		forward.x * 0 - forward.y * 0
	);
	const up = {
		x: right.y * forward.z - right.z * forward.y,
		y: right.z * forward.x - right.x * forward.z,
		z: right.x * forward.y - right.y * forward.x
	};
	return { direction: unit(forward.x, forward.y, forward.z), up, right };
}

function lookHeading(position: { x: number; y: number; z: number }) {
	const standpoint = (Math.atan2(position.x, position.y) * 180) / Math.PI;
	return (standpoint + 180 + 360) % 360;
}

function lookPitch(position: { x: number; y: number; z: number }) {
	const horizontal = Math.hypot(position.x, position.y);
	return (Math.atan2(-position.z, horizontal) * 180) / Math.PI;
}
