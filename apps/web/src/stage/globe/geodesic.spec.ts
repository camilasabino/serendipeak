import { describe, expect, it } from 'vitest';
import {
	EARTH_MEAN_RADIUS_METERS,
	greatCircleDistanceMeters,
	greatCirclePoint,
	initialBearingDegrees
} from './geodesic';

const LONDON = { latitude: 51.5074, longitude: -0.1278 };
const PARIS = { latitude: 48.8566, longitude: 2.3522 };
const CAPE_TOWN = { latitude: -33.9249, longitude: 18.4241 };
const NEW_YORK = { latitude: 40.7128, longitude: -74.006 };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };

describe('greatCircleDistanceMeters', () => {
	it('is zero for the same location', () => {
		expect(greatCircleDistanceMeters(LONDON, LONDON)).toBe(0);
	});

	it('measures a known short pair', () => {
		expect(greatCircleDistanceMeters(LONDON, PARIS) / 1000).toBeCloseTo(343.6, 0);
	});

	it('is symmetric', () => {
		expect(greatCircleDistanceMeters(NEW_YORK, SYDNEY)).toBeCloseTo(
			greatCircleDistanceMeters(SYDNEY, NEW_YORK),
			6
		);
	});

	it('does not turn a dateline crossing into a near-global distance', () => {
		const east = { latitude: 0, longitude: 179.5 };
		const west = { latitude: 0, longitude: -179.5 };

		expect(greatCircleDistanceMeters(east, west) / 1000).toBeCloseTo(111.2, 0);
	});

	it('crosses the dateline at high latitude by the short way', () => {
		const east = { latitude: 65, longitude: 179 };
		const west = { latitude: 65, longitude: -179 };

		expect(greatCircleDistanceMeters(east, west) / 1000).toBeLessThan(100);
	});

	it('measures a northern to southern hemisphere pair', () => {
		expect(greatCircleDistanceMeters(LONDON, CAPE_TOWN) / 1000).toBeCloseTo(9_670, -2);
	});

	it('measures a long intercontinental pair', () => {
		expect(greatCircleDistanceMeters(NEW_YORK, SYDNEY) / 1000).toBeCloseTo(15_990, -2);
	});

	it('stays finite and near half the circumference for near-antipodal points', () => {
		const distance = greatCircleDistanceMeters(
			{ latitude: 0, longitude: 0 },
			{ latitude: 0, longitude: 179.9 }
		);

		expect(Number.isFinite(distance)).toBe(true);
		expect(distance).toBeCloseTo(Math.PI * EARTH_MEAN_RADIUS_METERS, -5);
		expect(
			greatCircleDistanceMeters({ latitude: 10, longitude: 20 }, { latitude: -10, longitude: -160 })
		).toBeCloseTo(Math.PI * EARTH_MEAN_RADIUS_METERS, 3);
	});
});

describe('initialBearingDegrees', () => {
	it('points north, east, south and west on the axes', () => {
		const origin = { latitude: 0, longitude: 0 };

		expect(initialBearingDegrees(origin, { latitude: 10, longitude: 0 })).toBeCloseTo(0, 6);
		expect(initialBearingDegrees(origin, { latitude: 0, longitude: 10 })).toBeCloseTo(90, 6);
		expect(initialBearingDegrees(origin, { latitude: -10, longitude: 0 })).toBeCloseTo(180, 6);
		expect(initialBearingDegrees(origin, { latitude: 0, longitude: -10 })).toBeCloseTo(270, 6);
	});

	it('follows the short way across the dateline', () => {
		expect(
			initialBearingDegrees({ latitude: 0, longitude: 179 }, { latitude: 0, longitude: -179 })
		).toBeCloseTo(90, 6);
	});
});

describe('greatCirclePoint', () => {
	it('returns the end points at fractions 0 and 1', () => {
		const start = greatCirclePoint(LONDON, SYDNEY, 0);
		const end = greatCirclePoint(LONDON, SYDNEY, 1);

		expect(start.latitude).toBeCloseTo(LONDON.latitude, 8);
		expect(start.longitude).toBeCloseTo(LONDON.longitude, 8);
		expect(end.latitude).toBeCloseTo(SYDNEY.latitude, 8);
		expect(end.longitude).toBeCloseTo(SYDNEY.longitude, 8);
	});

	it('places the midpoint equally far from both ends', () => {
		const middle = greatCirclePoint(NEW_YORK, SYDNEY, 0.5);
		const total = greatCircleDistanceMeters(NEW_YORK, SYDNEY);

		expect(greatCircleDistanceMeters(NEW_YORK, middle)).toBeCloseTo(total / 2, 0);
		expect(greatCircleDistanceMeters(middle, SYDNEY)).toBeCloseTo(total / 2, 0);
	});

	it('keeps longitude in range across the dateline', () => {
		const middle = greatCirclePoint(
			{ latitude: 0, longitude: 179 },
			{ latitude: 0, longitude: -177 },
			0.5
		);

		expect(middle.longitude).toBeCloseTo(-179, 6);
		expect(middle.latitude).toBeCloseTo(0, 6);
	});

	it('returns the start for coincident points', () => {
		expect(greatCirclePoint(LONDON, LONDON, 0.5)).toEqual(LONDON);
	});

	it('moves monotonically along an antipodal route', () => {
		const start = { latitude: 10, longitude: 20 };
		const end = { latitude: -10, longitude: -160 };
		let previous = 0;
		for (const fraction of [0.25, 0.5, 0.75, 1]) {
			const point = greatCirclePoint(start, end, fraction);
			const traveled = greatCircleDistanceMeters(start, point);
			expect(Number.isFinite(point.latitude)).toBe(true);
			expect(traveled).toBeGreaterThan(previous);
			previous = traveled;
		}
	});
});
