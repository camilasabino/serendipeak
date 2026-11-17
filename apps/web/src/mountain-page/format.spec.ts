import { describe, it, expect } from 'vitest';
import {
	distinctCountryNames,
	formatCoordinates,
	formatCountries,
	formatPlaceParts
} from './format';

describe('formatCoordinates', () => {
	it('labels north and east', () => {
		expect(formatCoordinates({ latitude: 27.9881, longitude: 86.925 })).toBe(
			'27.9881° N, 86.9250° E'
		);
	});

	it('labels south and west without a sign', () => {
		expect(formatCoordinates({ latitude: -32.65305556, longitude: -70.01166667 })).toBe(
			'32.6531° S, 70.0117° W'
		);
	});

	it('leaves the equator and the prime meridian unlabeled', () => {
		expect(formatCoordinates({ latitude: 0, longitude: 0 })).toBe('0.0000°, 0.0000°');
	});

	it('keeps the poles labeled', () => {
		expect(formatCoordinates({ latitude: 90, longitude: 10 })).toBe('90.0000° N, 10.0000° E');
		expect(formatCoordinates({ latitude: -90, longitude: -10 })).toBe('90.0000° S, 10.0000° W');
	});

	it('leaves the antimeridian unlabeled from both sides', () => {
		expect(formatCoordinates({ latitude: 10, longitude: 180 })).toBe('10.0000° N, 180.0000°');
		expect(formatCoordinates({ latitude: 10, longitude: -180 })).toBe('10.0000° N, 180.0000°');
	});

	it('rounds to four decimals', () => {
		expect(formatCoordinates({ latitude: 1.23456, longitude: 2.5 })).toBe('1.2346° N, 2.5000° E');
	});

	it('never prints a negative zero', () => {
		expect(formatCoordinates({ latitude: -0, longitude: -0.00001 })).toBe('0.0000°, 0.0000°');
	});

	it('treats a value that rounds to the antimeridian as the antimeridian', () => {
		expect(formatCoordinates({ latitude: 0, longitude: 179.99996 })).toBe('0.0000°, 180.0000°');
	});
});

describe('formatCountries', () => {
	it('returns a single country unchanged', () => {
		expect(formatCountries(['Argentina'])).toBe('Argentina');
	});

	it('joins two countries with and', () => {
		expect(formatCountries(['Nepal', "People's Republic of China"])).toBe(
			"Nepal and People's Republic of China"
		);
	});

	it('uses a serial comma for three countries', () => {
		expect(formatCountries(['Austria', 'Italy', 'Switzerland'])).toBe(
			'Austria, Italy, and Switzerland'
		);
	});
});

describe('formatPlaceParts', () => {
	const europe = { code: 'EU', name: 'Europe' };
	const france = { code: 'FR', name: 'France' };
	const italy = { code: 'IT', name: 'Italy' };
	const massif = { slug: 'mont-blanc-massif', name: 'Mont Blanc massif', ancestors: [] };

	it('puts the region before the countries', () => {
		expect(formatPlaceParts(europe, [france, italy], massif)).toEqual([
			'Mont Blanc massif',
			'France and Italy'
		]);
	});

	it('names the region alone, without its ancestors', () => {
		const region = { ...massif, ancestors: [{ slug: 'alps', name: 'Alps' }] };

		expect(formatPlaceParts(europe, [france], region)).toEqual(['Mont Blanc massif', 'France']);
	});

	it('shows the countries alone when there is no region', () => {
		expect(formatPlaceParts(europe, [france], null)).toEqual(['France']);
	});

	it('falls back to the continent when there are no countries', () => {
		expect(formatPlaceParts(europe, [], null)).toEqual(['Europe']);
	});

	it('does not repeat a country that is the continent', () => {
		const antarctica = { code: 'AN', name: 'Antarctica' };
		const range = { slug: 'sentinel-range', name: 'Sentinel Range', ancestors: [] };

		expect(formatPlaceParts(antarctica, [antarctica], range)).toEqual([
			'Sentinel Range',
			'Antarctica'
		]);
	});
});

describe('distinctCountryNames', () => {
	const antarctica = { code: 'AN', name: 'Antarctica' };
	const chile = { code: 'CL', name: 'Chile' };

	it('drops a country that only repeats the continent', () => {
		expect(distinctCountryNames(antarctica, [antarctica])).toEqual([]);
		expect(distinctCountryNames(antarctica, [antarctica, chile])).toEqual(['Chile']);
	});

	it('keeps every other country in order', () => {
		expect(distinctCountryNames({ code: 'EU', name: 'Europe' }, [chile, antarctica])).toEqual([
			'Chile',
			'Antarctica'
		]);
	});
});
