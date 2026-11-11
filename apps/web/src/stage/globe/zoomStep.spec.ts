import { describe, expect, it } from 'vitest';
import {
	MAX_CAMERA_HEIGHT_METERS,
	MIN_FOCUS_DISTANCE_METERS,
	MIN_TERRAIN_CLEARANCE_METERS,
	clearedTravelMeters,
	zoomProgress,
	zoomTravelMeters,
	type ZoomGeometry
} from './zoomStep';

const AT_SUMMIT: ZoomGeometry = {
	focusDistanceMeters: 12_000,
	cameraHeightMeters: 9_000,
	climbPerMeterBack: 0.37
};

describe('zoomTravelMeters', () => {
	it('halves the distance to the focus when zooming in', () => {
		expect(zoomTravelMeters('in', AT_SUMMIT)).toBe(6_000);
	});

	it('doubles the distance to the focus when zooming out', () => {
		expect(zoomTravelMeters('out', AT_SUMMIT)).toBe(-12_000);
	});

	it('is symmetric: one step in and one step out return to the same distance', () => {
		const inward = zoomTravelMeters('in', AT_SUMMIT);
		const closer = { ...AT_SUMMIT, focusDistanceMeters: AT_SUMMIT.focusDistanceMeters - inward };

		expect(closer.focusDistanceMeters - zoomTravelMeters('out', closer)).toBe(12_000);
	});

	it('stops zooming in at the minimum focus distance', () => {
		const near = { ...AT_SUMMIT, focusDistanceMeters: 450 };

		expect(zoomTravelMeters('in', near)).toBe(450 - MIN_FOCUS_DISTANCE_METERS);
		expect(
			zoomTravelMeters('in', { ...AT_SUMMIT, focusDistanceMeters: MIN_FOCUS_DISTANCE_METERS })
		).toBe(0);
		expect(zoomTravelMeters('in', { ...AT_SUMMIT, focusDistanceMeters: 120 })).toBe(0);
	});

	it('caps zooming out at the maximum camera height', () => {
		const high = {
			focusDistanceMeters: 15_000_000,
			cameraHeightMeters: 15_000_000,
			climbPerMeterBack: 1
		};

		expect(zoomTravelMeters('out', high)).toBe(-(MAX_CAMERA_HEIGHT_METERS - 15_000_000));
		expect(zoomTravelMeters('out', { ...high, cameraHeightMeters: MAX_CAMERA_HEIGHT_METERS })).toBe(
			0
		);
		expect(
			zoomTravelMeters('out', { ...high, cameraHeightMeters: MAX_CAMERA_HEIGHT_METERS + 5 })
		).toBe(0);
	});

	it('lets a camera that looks upwards back away without a height cap', () => {
		expect(
			zoomTravelMeters('out', {
				focusDistanceMeters: 2_000,
				cameraHeightMeters: MAX_CAMERA_HEIGHT_METERS,
				climbPerMeterBack: -0.1
			})
		).toBe(-2_000);
	});

	it.each([
		['a zero focus distance', { ...AT_SUMMIT, focusDistanceMeters: 0 }],
		['a NaN focus distance', { ...AT_SUMMIT, focusDistanceMeters: Number.NaN }],
		['an infinite focus distance', { ...AT_SUMMIT, focusDistanceMeters: Number.POSITIVE_INFINITY }],
		['a NaN height', { ...AT_SUMMIT, cameraHeightMeters: Number.NaN }],
		['a NaN climb', { ...AT_SUMMIT, climbPerMeterBack: Number.NaN }]
	])('refuses to move on %s', (_label, geometry) => {
		expect(zoomTravelMeters('in', geometry)).toBe(0);
		expect(zoomTravelMeters('out', geometry)).toBe(0);
	});
});

describe('clearedTravelMeters', () => {
	// A camera 1000 m above ground that descends 0.5 m for every metre it moves forward.
	const descending = (travel: number) => 1_000 - 0.5 * travel;

	it('keeps a travel that stays clear of the ground', () => {
		expect(clearedTravelMeters(1_000, descending)).toBe(1_000);
	});

	it('stops short of the terrain instead of moving the destination', () => {
		const travel = clearedTravelMeters(2_000, descending);

		expect(travel).toBeGreaterThan(1_850);
		expect(travel).toBeLessThanOrEqual(1_900);
		expect(descending(travel)).toBeGreaterThanOrEqual(MIN_TERRAIN_CLEARANCE_METERS);
	});

	it('keeps the direction of a backwards travel', () => {
		const rising = (travel: number) => 1_000 + 0.5 * travel;

		expect(clearedTravelMeters(-2_000, rising)).toBeLessThan(0);
		expect(clearedTravelMeters(-2_000, rising)).toBeGreaterThan(-2_000);
	});

	it('does not trap a camera that is already low: it may only avoid getting lower', () => {
		const low = (travel: number) => 20 - 0.5 * travel;

		expect(clearedTravelMeters(500, low)).toBe(0);
		expect(clearedTravelMeters(-500, (travel) => 20 - 0.5 * travel)).toBe(-500);
	});

	it('moves freely when the ground is not known', () => {
		expect(clearedTravelMeters(5_000, () => undefined)).toBe(5_000);
	});
});

describe('zoomProgress', () => {
	it('runs from 0 to 1, monotonically, with zero speed at both ends', () => {
		const samples = Array.from({ length: 101 }, (_, index) => zoomProgress(index / 100));

		expect(samples[0]).toBe(0);
		expect(samples[100]).toBe(1);
		for (let index = 1; index < samples.length; index += 1) {
			expect(samples[index]!).toBeGreaterThanOrEqual(samples[index - 1]!);
		}
		expect(samples[1]!).toBeLessThan(0.001);
		expect(1 - samples[99]!).toBeLessThan(0.001);
		expect(zoomProgress(0.5)).toBe(0.5);
	});

	it('clamps outside the animation', () => {
		expect(zoomProgress(-1)).toBe(0);
		expect(zoomProgress(2)).toBe(1);
	});
});
