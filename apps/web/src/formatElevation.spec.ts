import { describe, it, expect } from 'vitest';
import { formatElevation, formatElevationValue } from './formatElevation';

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

describe('formatElevationValue', () => {
	it('is the grouped figure without the unit', () => {
		expect(formatElevationValue(6961)).toBe('6,961');
		expect(formatElevationValue(8848.86)).toBe('8,849');
	});
});

describe('imperial elevations', () => {
	it('converts with the exact foot and rounds to whole feet', () => {
		expect(formatElevation(8848.86, 'imperial')).toBe('29,032 ft');
		expect(formatElevation(1000, 'imperial')).toBe('3,281 ft');
		expect(formatElevation(0.3048, 'imperial')).toBe('1 ft');
		expect(formatElevationValue(852, 'imperial')).toBe('2,795');
	});

	it('is metric unless asked otherwise', () => {
		expect(formatElevation(6961)).toBe(formatElevation(6961, 'metric'));
	});
});
