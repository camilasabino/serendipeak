import { describe, expect, it } from 'vitest';
import { formatElevation } from '../formatElevation';
import { metersToFeet } from '../units/unitSystem';
import {
	bandBounds,
	bandFloorOf,
	bandSelection,
	inBands,
	sameSelection,
	type BandSelection
} from './elevationBands';

const ft = (...floors: number[]) => bandSelection('imperial', floors) as BandSelection;

describe('metric bands', () => {
	it.each([
		[0, 0],
		[999, 0],
		[999.999, 0],
		[1000, 1000],
		[4806, 4000],
		[8849, 8000],
		[8999.9, 8000],
		[9000, 9000]
	])('puts %d m in the band from %d m', (meters, floor) => {
		expect(bandFloorOf(meters, 'metric')).toBe(floor);
	});

	it('bounds a band by whole meters, half-open', () => {
		expect(bandBounds(4000, 'metric')).toEqual({ min: 4000, max: 5000 });
	});
});

describe('imperial bands', () => {
	it.each([
		[0, 0],
		[304.79, 0],
		[304.8, 1000],
		[1523, 4000],
		[1524, 5000],
		[2918, 9000],
		[3048, 10_000],
		[4806, 15_000],
		[6961, 22_000],
		[8849, 29_000]
	])('puts %d m in the band from %d ft', (meters, floor) => {
		expect(bandFloorOf(meters, 'imperial')).toBe(floor);
	});

	it('puts an elevation exactly on a whole thousand feet in the band it opens', () => {
		// 2,133.6 m is exactly 7,000 ft, though dividing by 0.3048 gives 6,999.999…
		expect(metersToFeet(2133.6)).toBeLessThan(7000);
		expect(bandFloorOf(2133.6, 'imperial')).toBe(7000);

		for (let floor = 0; floor <= 40_000; floor += 1000) {
			const meters = Number(((floor * 3048) / 10_000).toFixed(4));
			expect(bandFloorOf(meters, 'imperial')).toBe(floor);
			if (floor > 0) {
				expect(bandFloorOf(meters - 0.0001, 'imperial')).toBe(floor - 1000);
			}
		}
	});

	it('classifies by the unrounded feet, not by the figure shown', () => {
		// 4,267.1 m is 13,999.67 ft: shown as 14,000 ft, yet below the 14,000 ft band.
		expect(formatElevation(4267.1, 'imperial')).toBe('14,000 ft');
		expect(bandFloorOf(4267.1, 'imperial')).toBe(13_000);
		expect(bandFloorOf(4267.2, 'imperial')).toBe(14_000);
	});

	it('bounds a band by the exact meters of its whole feet, half-open', () => {
		expect(bandBounds(7000, 'imperial')).toEqual({ min: 2133.6, max: 2438.4 });
		expect(inBands(2133.6, ft(7000))).toBe(true);
		expect(inBands(2438.39, ft(7000))).toBe(true);
		expect(inBands(2438.4, ft(7000))).toBe(false);
		expect(inBands(2133.59, ft(7000))).toBe(false);
	});

	it('has no highest band: whatever a catalog holds gets one', () => {
		expect(bandFloorOf(10_000, 'imperial')).toBe(32_000);
	});
});

describe('band selections', () => {
	it('holds each band once, ascending, and is off when empty', () => {
		expect(bandSelection('imperial', [14_000, 9000, 14_000])).toEqual({
			system: 'imperial',
			floors: [9000, 14_000]
		});
		expect(bandSelection('metric', [])).toBeNull();
	});

	it('matches any of its bands', () => {
		const selection = ft(9000, 29_000);

		expect(inBands(2918, selection)).toBe(true);
		expect(inBands(8849, selection)).toBe(true);
		expect(inBands(4806, selection)).toBe(false);
	});

	it('tells selections apart by system as well as by bands', () => {
		expect(sameSelection(ft(4000), ft(4000))).toBe(true);
		expect(sameSelection(ft(4000), bandSelection('metric', [4000]))).toBe(false);
		expect(sameSelection(ft(4000), ft(4000, 5000))).toBe(false);
		expect(sameSelection(null, null)).toBe(true);
		expect(sameSelection(ft(4000), null)).toBe(false);
	});
});
