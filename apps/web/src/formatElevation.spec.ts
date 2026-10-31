import { describe, it, expect } from 'vitest';
import { formatElevation } from './formatElevation';

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
