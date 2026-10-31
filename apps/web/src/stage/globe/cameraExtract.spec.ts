import { describe, expect, it } from 'vitest';
import {
	CESIUM_DEFAULT_FOV_RADIANS,
	cameraOffsetFromPose,
	cesiumVerticalFovRadians,
	lookAxesForFraming,
	projectSummitNormalized
} from './framing';
import { previewOffset, readSummitCamera, stageAspectScale } from './terrainCamera';

function offsetFromLook(headingDegrees: number, pitchDegrees: number, displayRangeMeters: number) {
	const standpoint = (((headingDegrees + 180) % 360) * Math.PI) / 180;
	const pitch = (pitchDegrees * Math.PI) / 180;
	const horizontal = Math.cos(pitch) * displayRangeMeters;
	const up = -Math.sin(pitch) * displayRangeMeters;
	return {
		east: Math.sin(standpoint) * horizontal,
		north: Math.cos(standpoint) * horizontal,
		up
	};
}

describe('stage aspect scale', () => {
	it('is 1 when the stage aspect is 1.35', () => {
		expect(stageAspectScale(1350, 1000)).toBe(1);
	});

	it('clamps a narrow stage to 1.25 and a wide stage to 0.85', () => {
		expect(stageAspectScale(560, 762)).toBe(1.25);
		expect(stageAspectScale(895, 468)).toBe(0.85);
		expect(stageAspectScale(400, 1000)).toBe(1.25);
		expect(stageAspectScale(3000, 500)).toBe(0.85);
	});
});

describe('summit camera extraction', () => {
	it('reads heading as the look direction, not the standpoint', () => {
		const north = readSummitCamera(0, 10_000, 0, 1350, 1000);
		const south = readSummitCamera(0, -10_000, 0, 1350, 1000);

		expect(north.headingDegrees).toBeCloseTo(180, 6);
		expect(south.headingDegrees).toBeCloseTo(0, 6);
		expect(Math.abs(north.headingDegrees - south.headingDegrees)).toBeCloseTo(180, 6);
	});

	it('keeps the negative oblique pitch of a camera above the summit', () => {
		const reading = readSummitCamera(0, -10_000, 2_870, 1350, 1000);

		expect(reading.headingDegrees).toBeCloseTo(0, 5);
		expect(reading.pitchDegrees).toBeLessThan(0);
		expect(reading.pitchDegrees).toBeCloseTo(Math.atan2(-2870, 10_000) * (180 / Math.PI), 5);
	});

	it('reports the display range separately from the base range', () => {
		const base = 10_519;
		const scale = stageAspectScale(560, 762);
		const display = base * scale;
		const offset = offsetFromLook(347.62, -16.84, display);
		const reading = readSummitCamera(offset.east, offset.north, offset.up, 560, 762);

		expect(reading.aspectScale).toBe(1.25);
		expect(reading.stageAspect).toBeCloseTo(560 / 762, 6);
		expect(reading.displayRangeMeters).toBeCloseTo(display, 4);
		expect(reading.baseRangeMeters).toBeCloseTo(base, 4);
		expect(reading.baseRangeMeters).not.toBeCloseTo(reading.displayRangeMeters, 0);
	});

	it('recovers base range by dividing the display range by the current aspect scale', () => {
		const base = 9_000;
		const width = 895;
		const height = 468;
		const scale = stageAspectScale(width, height);
		const display = base * scale;
		const offset = offsetFromLook(200, -18, display);
		const reading = readSummitCamera(offset.east, offset.north, offset.up, width, height);

		expect(scale).toBe(0.85);
		expect(reading.baseRangeMeters).toBeCloseTo(display / scale, 4);
		expect(reading.baseRangeMeters).toBeCloseTo(base, 4);
		expect(display * scale).toBeLessThan(base * 0.9);
	});
});

describe('selected pose round trip', () => {
	it('replays heading, pitch, and aspect-adjusted range without a 180 degree inversion', () => {
		const headingDegrees = 347.62;
		const pitchDegrees = -16.84;
		const baseRangeMeters = 10_519;
		const width = 1037;
		const height = 786;
		const offset = previewOffset(
			{ headingDegrees, pitchDegrees, rangeMeters: baseRangeMeters },
			width,
			height
		);
		const placed = offsetFromLook(
			(offset.headingRadians * 180) / Math.PI,
			(offset.pitchRadians * 180) / Math.PI,
			offset.rangeMeters
		);
		const reading = readSummitCamera(placed.east, placed.north, placed.up, width, height);
		const inverted = (headingDegrees + 180) % 360;

		expect(offset.rollRadians).toBe(0);
		expect(offset.rangeMeters).toBeCloseTo(baseRangeMeters * stageAspectScale(width, height), 5);
		expect(reading.headingDegrees).toBeCloseTo(headingDegrees, 4);
		expect(Math.abs(reading.headingDegrees - inverted)).toBeGreaterThan(170);
		expect(reading.pitchDegrees).toBeCloseTo(pitchDegrees, 4);
		expect(reading.baseRangeMeters).toBeCloseTo(baseRangeMeters, 3);
		expect(reading.displayRangeMeters).toBeCloseTo(offset.rangeMeters, 3);
	});

	it('keeps an arbitrary look that does not pass through the summit', () => {
		const width = 1626;
		const height = 1053;
		const aspect = width / height;
		const fovy = cesiumVerticalFovRadians(CESIUM_DEFAULT_FOV_RADIANS, aspect);
		const position = { x: 900, y: 5_800, z: 3_900 };
		const towardSummit = unit(-position.x, -position.y, -position.z);
		const look = rotateAround(towardSummit, unit(-towardSummit.y, towardSummit.x, 0), 6);
		const aimed = projectSummitNormalized(position, axesFromForward(towardSummit), fovy, aspect);
		const manual = projectSummitNormalized(position, axesFromForward(look), fovy, aspect);
		const reading = readSummitCamera(position.x, position.y, position.z, width, height);
		const replay = previewOffset(
			{
				headingDegrees: reading.headingDegrees,
				pitchDegrees: reading.pitchDegrees,
				rangeMeters: reading.baseRangeMeters,
				framing: manual
			},
			width,
			height
		);
		const rebuilt = cameraOffsetFromPose(
			(replay.headingRadians * 180) / Math.PI,
			(replay.pitchRadians * 180) / Math.PI,
			replay.rangeMeters
		);
		const axes = lookAxesForFraming(
			rebuilt,
			{ x: replay.framingX, y: replay.framingY },
			fovy,
			aspect
		);
		const projected = axes ? projectSummitNormalized(rebuilt, axes, fovy, aspect) : undefined;
		const errorX = Math.abs((projected?.x ?? 2) - (manual?.x ?? 0)) * (width / 2);
		const errorY = Math.abs((projected?.y ?? 2) - (manual?.y ?? 0)) * (height / 2);

		expect(Math.hypot(aimed?.x ?? 1, aimed?.y ?? 1)).toBeLessThan(1e-8);
		expect(Math.hypot(manual?.x ?? 0, manual?.y ?? 0)).toBeGreaterThan(0.05);
		expect(angleBetween(look, towardSummit)).toBeCloseTo(6, 5);
		expect(replay.rollRadians).toBe(0);
		expect(replay.framingX).not.toBe(0);
		expect(errorX).toBeLessThanOrEqual(1);
		expect(errorY).toBeLessThanOrEqual(1);
		expect(
			Math.hypot(rebuilt.x - position.x, rebuilt.y - position.y, rebuilt.z - position.z)
		).toBeLessThan(1);
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
	const direction = unit(forward.x, forward.y, forward.z);
	const right = unit(direction.y, -direction.x, 0);
	return {
		direction,
		right,
		up: {
			x: right.y * direction.z - right.z * direction.y,
			y: right.z * direction.x - right.x * direction.z,
			z: right.x * direction.y - right.y * direction.x
		}
	};
}

function angleBetween(
	a: { x: number; y: number; z: number },
	b: { x: number; y: number; z: number }
) {
	return (Math.acos(Math.min(1, Math.max(-1, dot(a, b)))) * 180) / Math.PI;
}
