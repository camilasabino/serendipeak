import { describe, expect, it } from 'vitest';
import {
	CESIUM_DEFAULT_FOV_RADIANS,
	cesiumVerticalFovRadians,
	lookAxesForFraming
} from './framing';
import {
	cardinalLabel,
	compassRoseRotationDegrees,
	compassSpokenLabel,
	degreesFromRadians,
	displayHeadingDegrees,
	formatBearing,
	normalizeDegrees,
	viewHeadingDegrees,
	viewpointBearingDegrees
} from './orientation';
import { cameraStandpointDegrees, readSummitCamera } from './terrainCamera';

describe('degree normalization', () => {
	it('wraps finite angles into [0, 360)', () => {
		expect(normalizeDegrees(0)).toBe(0);
		expect(normalizeDegrees(360)).toBe(0);
		expect(normalizeDegrees(720.2)).toBeCloseTo(0.2, 6);
		expect(normalizeDegrees(-10)).toBeCloseTo(350, 6);
		expect(normalizeDegrees(359.2)).toBeCloseTo(359.2, 6);
		expect(normalizeDegrees(90)).toBe(90);
	});

	it('rejects a non-finite angle', () => {
		expect(normalizeDegrees(Number.NaN)).toBeNaN();
		expect(normalizeDegrees(Number.POSITIVE_INFINITY)).toBeNaN();
	});
});

describe('radians to degrees', () => {
	it('normalizes a radian heading into degrees', () => {
		expect(degreesFromRadians(0)).toBe(0);
		expect(degreesFromRadians(Math.PI / 2)).toBeCloseTo(90, 6);
		expect(degreesFromRadians(Math.PI)).toBeCloseTo(180, 6);
		expect(degreesFromRadians((3 * Math.PI) / 2)).toBeCloseTo(270, 6);
		expect(degreesFromRadians(Math.PI * 2)).toBe(0);
		expect(degreesFromRadians(-Math.PI / 2)).toBeCloseTo(270, 6);
	});
});

describe('display heading', () => {
	it('rounds to an integer in [0, 360) and wraps 359.5 up to 0', () => {
		expect(displayHeadingDegrees(0)).toBe(0);
		expect(displayHeadingDegrees(189.4)).toBe(189);
		expect(displayHeadingDegrees(189.5)).toBe(190);
		expect(displayHeadingDegrees(359.4)).toBe(359);
		expect(displayHeadingDegrees(359.6)).toBe(0);
		expect(displayHeadingDegrees(-0.4)).toBe(0);
		expect(displayHeadingDegrees(Number.NaN)).toBeNaN();
	});
});

describe('cardinal labels', () => {
	it.each([
		[0, 'N'],
		[22.499, 'N'],
		[337.5, 'N'],
		[22.5, 'NE'],
		[47, 'NE'],
		[67.499, 'NE'],
		[67.5, 'E'],
		[90, 'E'],
		[112.5, 'SE'],
		[157.5, 'S'],
		[189, 'S'],
		[202.5, 'SW'],
		[247.5, 'W'],
		[274, 'W'],
		[292.5, 'NW'],
		[337.499, 'NW']
	])('maps %s° to %s', (degrees, label) => {
		expect(cardinalLabel(degrees)).toBe(label);
	});

	it('normalizes before choosing a sector', () => {
		expect(cardinalLabel(-10)).toBe('N');
		expect(cardinalLabel(360)).toBe('N');
		expect(cardinalLabel(720 + 90)).toBe('E');
	});

	it('has no label for a non-finite heading', () => {
		expect(cardinalLabel(Number.NaN)).toBeUndefined();
	});
});

describe('bearing text', () => {
	it('formats an integer heading with its cardinal', () => {
		expect(formatBearing(0)).toBe('0° · N');
		expect(formatBearing(47)).toBe('47° · NE');
		expect(formatBearing(189)).toBe('189° · S');
		expect(formatBearing(274)).toBe('274° · W');
		expect(formatBearing(359.6)).toBe('0° · N');
	});

	it('speaks the compass without using a live region', () => {
		expect(compassSpokenLabel(189)).toBe('Compass. Looking 189 degrees south.');
		expect(compassSpokenLabel(47.2)).toBe('Compass. Looking 47 degrees northeast.');
		expect(compassSpokenLabel(Number.NaN)).toBeUndefined();
	});
});

describe('compass rose rotation', () => {
	it('puts north at the top when the camera looks north', () => {
		expect(compassRoseRotationDegrees(0)).toBe(0);
	});

	it('moves north to the left when the camera looks east', () => {
		expect(compassRoseRotationDegrees(90)).toBe(-90);
	});

	it('puts north at the bottom when the camera looks south', () => {
		expect(compassRoseRotationDegrees(180)).toBe(-180);
	});

	it('moves north to the right when the camera looks west', () => {
		expect(compassRoseRotationDegrees(270)).toBe(-270);
	});

	it('does not unwind 359° into a full reverse spin', () => {
		expect(compassRoseRotationDegrees(359)).toBe(-359);
		expect(compassRoseRotationDegrees(0)).toBe(0);
		expect(compassRoseRotationDegrees(360)).toBe(0);
	});

	it('is the opposite of the normalized view heading', () => {
		expect(compassRoseRotationDegrees(90)).not.toBe(90);
		expect(compassRoseRotationDegrees(Number.NaN)).toBeNaN();
	});
});

describe('actual view heading', () => {
	it('matches Cesium local-east-north heading for the four cardinals', () => {
		expect(viewHeadingDegrees(0, 1, 0)).toBeCloseTo(0, 6);
		expect(viewHeadingDegrees(1, 0, 0)).toBeCloseTo(90, 6);
		expect(viewHeadingDegrees(0, -1, 0)).toBeCloseTo(180, 6);
		expect(viewHeadingDegrees(-1, 0, 0)).toBeCloseTo(270, 6);
	});

	it('uses the up vector when the look is vertical', () => {
		expect(viewHeadingDegrees(0, 0, -1, 1, 0)).toBeCloseTo(90, 6);
		expect(viewHeadingDegrees(0, 0, 1, 0, -1)).toBeCloseTo(180, 6);
	});

	it('rejects a non-finite direction', () => {
		expect(viewHeadingDegrees(Number.NaN, 1, 0)).toBeNaN();
	});
});

describe('viewpoint bearing', () => {
	it('is the geographic side of the summit the camera stands on', () => {
		expect(viewpointBearingDegrees(0, 10_000)).toBeCloseTo(0, 6);
		expect(viewpointBearingDegrees(10_000, 0)).toBeCloseTo(90, 6);
		expect(viewpointBearingDegrees(0, -10_000)).toBeCloseTo(180, 6);
		expect(viewpointBearingDegrees(-10_000, 0)).toBeCloseTo(270, 6);
	});

	it('matches the summit-relative standpoint and not the look direction', () => {
		const east = 4_000;
		const north = -7_000;
		const reading = readSummitCamera(east, north, 2_000, 1350, 1000);
		const viewpoint = viewpointBearingDegrees(east, north);

		expect(viewpoint).toBeCloseTo(cameraStandpointDegrees(reading.headingDegrees), 5);
		expect(Math.abs(viewpoint - reading.headingDegrees)).toBeGreaterThan(90);
	});

	it('is undefined directly above the summit or when the offset is not finite', () => {
		expect(viewpointBearingDegrees(0, 0)).toBeNaN();
		expect(viewpointBearingDegrees(Number.NaN, 10)).toBeNaN();
	});
});

describe('framing changes view heading and leaves viewpoint', () => {
	it('keeps the camera side of the summit when the look direction changes', () => {
		const east = 0;
		const north = -8_000;
		const up = 2_500;
		const position = { x: east, y: north, z: up };
		const width = 1350;
		const height = 1000;
		const aspect = width / height;
		const fovy = cesiumVerticalFovRadians(CESIUM_DEFAULT_FOV_RADIANS, aspect);
		const centered = lookAxesForFraming(position, { x: 0, y: 0 }, fovy, aspect);
		const shifted = lookAxesForFraming(position, { x: 0.45, y: 0.1 }, fovy, aspect);
		const canonical = readSummitCamera(east, north, up, width, height);
		const viewpoint = viewpointBearingDegrees(east, north);
		const centeredHeading = viewHeadingDegrees(
			centered?.direction.x ?? Number.NaN,
			centered?.direction.y ?? Number.NaN,
			centered?.direction.z ?? Number.NaN
		);
		const shiftedHeading = viewHeadingDegrees(
			shifted?.direction.x ?? Number.NaN,
			shifted?.direction.y ?? Number.NaN,
			shifted?.direction.z ?? Number.NaN
		);

		expect(viewpoint).toBeCloseTo(180, 5);
		expect(viewpointBearingDegrees(east, north)).toBeCloseTo(viewpoint, 8);
		expect(centeredHeading).toBeCloseTo(canonical.headingDegrees, 4);
		expect(Math.abs(shiftedHeading - centeredHeading)).toBeGreaterThan(5);
		expect(compassRoseRotationDegrees(shiftedHeading)).toBeCloseTo(-shiftedHeading, 6);
		expect(shiftedHeading).not.toBeCloseTo(canonical.headingDegrees, 0);
	});
});
