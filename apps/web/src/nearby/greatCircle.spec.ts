import { describe, expect, it } from 'vitest';
import { EARTH_RADIUS_KM, greatCircleDistanceKm } from './greatCircle';

const point = (latitude: number, longitude: number) => ({ latitude, longitude });

describe('greatCircleDistanceKm', () => {
	it('is zero between a point and itself', () => {
		expect(greatCircleDistanceKm(point(45.8326, 6.8652), point(45.8326, 6.8652))).toBe(0);
	});

	it('matches a known city pair: Paris to London is about 344 km', () => {
		const distance = greatCircleDistanceKm(point(48.8566, 2.3522), point(51.5074, -0.1278));

		expect(distance).toBeCloseTo(343.6, 0);
	});

	it('matches a known long pair: New York to Los Angeles is about 3,936 km', () => {
		const distance = greatCircleDistanceKm(point(40.7128, -74.006), point(34.0522, -118.2437));

		expect(distance).toBeGreaterThan(3930);
		expect(distance).toBeLessThan(3945);
	});

	it('covers a degree of latitude as a degree of arc', () => {
		expect(greatCircleDistanceKm(point(0, 0), point(1, 0))).toBeCloseTo(
			(EARTH_RADIUS_KM * Math.PI) / 180,
			6
		);
	});

	it('is symmetric', () => {
		const a = point(-32.6531, -70.012);
		const b = point(-49.2713, -73.0432);

		expect(greatCircleDistanceKm(a, b)).toBeCloseTo(greatCircleDistanceKm(b, a), 9);
	});

	it('crosses the antimeridian the short way', () => {
		const east = point(0, 179.5);
		const west = point(0, -179.5);

		expect(greatCircleDistanceKm(east, west)).toBeCloseTo((EARTH_RADIUS_KM * Math.PI) / 180, 6);
	});

	it('gives the same distance for a longitude written as 190 and as -170', () => {
		const origin = point(10, 170);

		expect(greatCircleDistanceKm(origin, point(10, 190))).toBeCloseTo(
			greatCircleDistanceKm(origin, point(10, -170)),
			9
		);
	});

	it('converges the meridians at the poles', () => {
		expect(greatCircleDistanceKm(point(90, 0), point(90, 120))).toBeCloseTo(0, 6);
	});

	it('is half the circumference between antipodes, without a NaN from rounding', () => {
		const distance = greatCircleDistanceKm(point(30, 40), point(-30, -140));

		expect(distance).toBeCloseTo(Math.PI * EARTH_RADIUS_KM, 4);
	});
});
