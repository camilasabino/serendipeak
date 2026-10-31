import { describe, expect, it } from 'vitest';
import { formatDistance, niceDistanceMeters, scaleBarFor, scaleSpecForStage } from './scaleBar';

describe('niceDistanceMeters', () => {
	it.each([
		[1, 1],
		[1.9, 1],
		[2, 2],
		[4.99, 2],
		[5, 5],
		[9.99, 5],
		[10, 10],
		[137, 100],
		[250, 200],
		[750, 500],
		[999, 500],
		[1000, 1000],
		[1_800_000, 1_000_000]
	])('picks the largest 1/2/5 value not above %f m', (max, expected) => {
		expect(niceDistanceMeters(max)).toBe(expected);
	});

	it('rejects values below one meter and non finite values', () => {
		expect(niceDistanceMeters(0.4)).toBeUndefined();
		expect(niceDistanceMeters(Number.NaN)).toBeUndefined();
		expect(niceDistanceMeters(Number.POSITIVE_INFINITY)).toBeUndefined();
	});

	it('survives floating point noise at decade boundaries', () => {
		expect(niceDistanceMeters(0.1 * 3 * 1000)).toBe(200);
		expect(niceDistanceMeters(1000 - 1e-12)).toBe(1000);
	});
});

describe('formatDistance', () => {
	it('uses meters below one kilometer', () => {
		expect(formatDistance(100)).toBe('100 m');
		expect(formatDistance(500)).toBe('500 m');
	});

	it('uses kilometers from one kilometer', () => {
		expect(formatDistance(1000)).toBe('1 km');
		expect(formatDistance(5000)).toBe('5 km');
		expect(formatDistance(20_000)).toBe('20 km');
		expect(formatDistance(2_000_000)).toBe('2,000 km');
	});
});

describe('scaleBarFor', () => {
	it('derives a metric value and its pixel width from a measured ground distance', () => {
		const reading = scaleBarFor(1_000, 120, 120);

		expect(reading?.meters).toBe(1000);
		expect(reading?.label).toBe('1 km');
		expect(reading?.widthPx).toBeCloseTo(120, 6);
	});

	it('shrinks the bar when the nice value is below the measured maximum', () => {
		const reading = scaleBarFor(750, 120, 120);

		expect(reading?.meters).toBe(500);
		expect(reading?.label).toBe('500 m');
		expect(reading?.widthPx).toBeCloseTo(80, 6);
	});

	it('scales the bar by the measured pixels, not the maximum width', () => {
		const reading = scaleBarFor(2_000, 100, 120);

		expect(reading?.meters).toBe(2000);
		expect(reading?.widthPx).toBeCloseTo(100, 6);
		expect(reading?.label).toBe('2 km');
	});

	it('keeps the bar between 40% and 100% of the maximum width', () => {
		for (let ground = 40; ground < 400_000; ground *= 1.37) {
			const reading = scaleBarFor(ground, 120, 120);
			expect(reading).toBeDefined();
			expect(reading!.widthPx).toBeLessThanOrEqual(120 + 1e-6);
			expect(reading!.widthPx).toBeGreaterThanOrEqual(120 * 0.4 - 1e-6);
		}
	});

	it('hides the scale for invalid measurements', () => {
		expect(scaleBarFor(Number.NaN, 120, 120)).toBeUndefined();
		expect(scaleBarFor(0, 120, 120)).toBeUndefined();
		expect(scaleBarFor(-5, 120, 120)).toBeUndefined();
		expect(scaleBarFor(1000, 0, 120)).toBeUndefined();
		expect(scaleBarFor(1000, 120, 0)).toBeUndefined();
		expect(scaleBarFor(Number.POSITIVE_INFINITY, 120, 120)).toBeUndefined();
	});

	it('hides the scale outside the meaningful metric range', () => {
		expect(scaleBarFor(0.3, 120, 120)).toBeUndefined();
		expect(scaleBarFor(9_000_000, 120, 120)).toBeUndefined();
	});
});

describe('scaleSpecForStage', () => {
	it('uses a shorter bar on narrow stages', () => {
		expect(scaleSpecForStage(390).maxWidthPx).toBeLessThan(scaleSpecForStage(1037).maxWidthPx);
	});

	it('lifts the scale above credits that wrap on very narrow stages', () => {
		expect(scaleSpecForStage(320).bottomPx).toBeGreaterThan(scaleSpecForStage(390).bottomPx);
		expect(scaleSpecForStage(390).bottomPx).toBe(scaleSpecForStage(1037).bottomPx);
	});

	it('falls back to the wide spec before the stage is measured', () => {
		expect(scaleSpecForStage(0)).toEqual(scaleSpecForStage(1440));
	});
});
