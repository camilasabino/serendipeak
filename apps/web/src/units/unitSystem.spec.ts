import { describe, expect, it } from 'vitest';
import {
	elevationIn,
	elevationUnit,
	isUnitSystem,
	METERS_PER_FOOT,
	metersToFeet
} from './unitSystem';

describe('unitSystem', () => {
	it('uses the international foot exactly', () => {
		expect(METERS_PER_FOOT).toBe(0.3048);
		expect(metersToFeet(0.3048)).toBe(1);
		expect(metersToFeet(3048)).toBeCloseTo(10000, 9);
	});

	it('leaves meters untouched in the metric system', () => {
		expect(elevationIn(4806, 'metric')).toBe(4806);
		expect(elevationUnit('metric')).toBe('m');
		expect(elevationUnit('imperial')).toBe('ft');
	});

	it('recognises only the two systems', () => {
		expect(isUnitSystem('metric')).toBe(true);
		expect(isUnitSystem('imperial')).toBe(true);
		expect(isUnitSystem('feet')).toBe(false);
		expect(isUnitSystem(null)).toBe(false);
	});
});
