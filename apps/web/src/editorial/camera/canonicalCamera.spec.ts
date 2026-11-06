import { describe, expect, it } from 'vitest';
import { assessCamera, quantizeCamera } from './canonicalCamera';

const READING = {
	headingDegrees: 123.456,
	pitchDegrees: -12.3456,
	rangeMeters: 4321.6,
	framing: { x: 0.12345, y: -0.25004 }
};

describe('quantizeCamera', () => {
	it('keeps two decimals for the angles, whole meters and four decimals for the framing', () => {
		expect(quantizeCamera(READING)).toEqual({
			headingDegrees: 123.46,
			pitchDegrees: -12.35,
			rangeMeters: 4322,
			framing: { x: 0.1235, y: -0.25 }
		});
	});

	it.each([
		[359.996, 0],
		[359.994, 359.99],
		[360, 0],
		[-0.004, 0],
		[-0.006, 359.99],
		[725.5, 5.5]
	])('wraps heading %s into [0, 360) as %s', (heading, expected) => {
		expect(quantizeCamera({ ...READING, headingDegrees: heading }).headingDegrees).toBe(expected);
	});

	it('never produces a negative zero', () => {
		const camera = quantizeCamera({
			...READING,
			pitchDegrees: -0.001,
			framing: { x: -0.00001, y: 0 }
		});

		expect(Object.is(camera.pitchDegrees, 0)).toBe(true);
		expect(Object.is(camera.framing?.x, 0)).toBe(true);
	});

	it('leaves the framing absent when it was not read', () => {
		expect(quantizeCamera({ headingDegrees: 1, pitchDegrees: 2, rangeMeters: 3000 })).toEqual({
			headingDegrees: 1,
			pitchDegrees: 2,
			rangeMeters: 3000
		});
	});
});

describe('assessCamera', () => {
	it('accepts a camera inside the catalog bounds and returns it quantized with its framing', () => {
		expect(assessCamera(READING)).toEqual({
			valid: true,
			camera: {
				headingDegrees: 123.46,
				pitchDegrees: -12.35,
				rangeMeters: 4322,
				framing: { x: 0.1235, y: -0.25 }
			}
		});
	});

	it.each([
		['pitch', { pitchDegrees: -60.01 }, false],
		['pitch', { pitchDegrees: -60 }, true],
		['pitch', { pitchDegrees: 15 }, true],
		['pitch', { pitchDegrees: 15.01 }, false],
		['range', { rangeMeters: 1999.4 }, false],
		['range', { rangeMeters: 2000 }, true],
		['range', { rangeMeters: 80_000.4 }, true],
		['range', { rangeMeters: 80_000.6 }, false]
	])('checks the %s bound after rounding: %j is valid %s', (_name, change, valid) => {
		expect(assessCamera({ ...READING, ...change }).valid).toBe(valid);
	});

	it('judges the rounded values, so a pitch that rounds into bounds is accepted', () => {
		expect(assessCamera({ ...READING, pitchDegrees: 15.004 }).valid).toBe(true);
	});

	it('refuses a missing framing: the summit is not on screen', () => {
		expect(assessCamera({ headingDegrees: 10, pitchDegrees: -10, rangeMeters: 5000 })).toEqual({
			valid: false,
			camera: { headingDegrees: 10, pitchDegrees: -10, rangeMeters: 5000 },
			problems: ['framing-missing']
		});
	});

	it.each([[{ x: 1.0001, y: 0 }], [{ x: 0, y: -1.0001 }]])(
		'refuses framing %j outside the stage',
		(framing) => {
			expect(assessCamera({ ...READING, framing })).toMatchObject({
				valid: false,
				problems: ['framing-out-of-bounds']
			});
		}
	);

	it('accepts a framing exactly on the stage edge', () => {
		expect(assessCamera({ ...READING, framing: { x: 1, y: -1 } }).valid).toBe(true);
	});

	it('reports every problem at once', () => {
		expect(assessCamera({ headingDegrees: 10, pitchDegrees: 40, rangeMeters: 1 })).toMatchObject({
			valid: false,
			problems: ['out-of-bounds', 'framing-missing']
		});
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY])('treats %s as out of bounds', (value) => {
		expect(assessCamera({ ...READING, rangeMeters: value })).toMatchObject({
			valid: false,
			problems: ['out-of-bounds']
		});
		expect(assessCamera({ ...READING, headingDegrees: value }).valid).toBe(false);
	});
});
