import { describe, it, expect } from 'vitest';
import { formatCoordinates, formatCountries, formatElevation } from './format';

describe('formatElevation', () => {
	it('groups thousands with a comma and appends the unit', () => {
		expect(formatElevation(6961)).toBe('6,961 m');
	});

	it('does not add a separator below one thousand', () => {
		expect(formatElevation(852)).toBe('852 m');
	});

	it('rounds fractional meters', () => {
		expect(formatElevation(8848.86)).toBe('8,849 m');
	});
});

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
