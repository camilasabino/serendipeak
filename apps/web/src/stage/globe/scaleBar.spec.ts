import { describe, expect, it } from 'vitest';
import { METERS_PER_FOOT } from '../../units/unitSystem';
import { formatDistance, niceDistanceMeters, scaleBarFor, scaleSpecForStage } from './scaleBar';

const METERS_PER_MILE = 5280 * METERS_PER_FOOT;
const feet = (value: number) => value * METERS_PER_FOOT;
const miles = (value: number) => value * METERS_PER_MILE;

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

describe('niceDistanceMeters in imperial units', () => {
	it.each([
		[feet(3.3), feet(2)],
		[feet(4.99), feet(2)],
		[feet(5), feet(5)],
		[feet(137), feet(100)],
		[feet(250), feet(200)],
		[feet(999), feet(500)],
		[feet(1000), feet(1000)],
		[feet(4999), feet(2000)],
		[feet(5000), feet(5000)],
		[feet(5279), feet(5000)]
	])('picks the largest 1/2/5 feet value not above %f m', (max, expected) => {
		expect(niceDistanceMeters(max, 'imperial')).toBeCloseTo(expected, 9);
	});

	it.each([
		[miles(1), miles(1)],
		[miles(1.9), miles(1)],
		[miles(2), miles(2)],
		[miles(7), miles(5)],
		[miles(10), miles(10)],
		[miles(99), miles(50)],
		[miles(250), miles(200)],
		[miles(1000), miles(1000)]
	])('picks the largest 1/2/5 miles value not above %f m', (max, expected) => {
		expect(niceDistanceMeters(max, 'imperial')).toBeCloseTo(expected, 6);
	});

	it('switches from feet to miles exactly at one mile', () => {
		expect(niceDistanceMeters(miles(1) - 0.001, 'imperial')).toBeCloseTo(feet(5000), 9);
		expect(niceDistanceMeters(miles(1), 'imperial')).toBeCloseTo(miles(1), 9);
		expect(niceDistanceMeters(miles(1) + 0.001, 'imperial')).toBeCloseTo(miles(1), 9);
	});

	it('chooses steps in feet and miles, not converted metric steps', () => {
		// 150 m is 492 ft: a converted metric 100 m would read 328 ft, an awkward figure.
		const distance = niceDistanceMeters(150, 'imperial')!;

		expect(distance / METERS_PER_FOOT).toBeCloseTo(200, 6);
		expect(formatDistance(distance, 'imperial')).toBe('200 ft');
	});

	it('shares the metric range: nothing below one meter and nothing for non finite values', () => {
		expect(niceDistanceMeters(feet(3), 'imperial')).toBeUndefined();
		expect(niceDistanceMeters(0.4, 'imperial')).toBeUndefined();
		expect(niceDistanceMeters(Number.NaN, 'imperial')).toBeUndefined();
		expect(niceDistanceMeters(Number.POSITIVE_INFINITY, 'imperial')).toBeUndefined();
	});

	it('survives floating point noise at the decade and mile boundaries', () => {
		expect(niceDistanceMeters(feet(1000) - 1e-9, 'imperial')).toBeCloseTo(feet(1000), 6);
		expect(niceDistanceMeters(miles(1) * (1 - 1e-12), 'imperial')).toBeCloseTo(miles(1), 6);
	});

	it('leaves the metric result alone when the system is metric or omitted', () => {
		expect(niceDistanceMeters(137, 'metric')).toBe(100);
		expect(niceDistanceMeters(137)).toBe(100);
	});
});

describe('formatDistance in imperial units', () => {
	it.each([
		[feet(1), '1 ft'],
		[feet(100), '100 ft'],
		[feet(500), '500 ft'],
		[feet(1000), '1,000 ft'],
		[feet(5000), '5,000 ft'],
		[miles(1), '1 mi'],
		[miles(2), '2 mi'],
		[miles(50), '50 mi'],
		[miles(1000), '1,000 mi']
	])('words %f m as %s', (meters, label) => {
		expect(formatDistance(meters, 'imperial')).toBe(label);
	});

	it('words the same distance in either system', () => {
		expect(formatDistance(1000, 'metric')).toBe('1 km');
		expect(formatDistance(1000, 'imperial')).toBe('3,281 ft');
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

describe('scaleBarFor in imperial units', () => {
	it('words a short span in feet with a bar as wide as the ground it stands for', () => {
		const reading = scaleBarFor(feet(750), 120, 120, 'imperial');

		expect(reading?.label).toBe('500 ft');
		expect(reading?.meters).toBeCloseTo(feet(500), 9);
		expect(reading?.widthPx).toBeCloseTo(80, 6);
	});

	it('words a long span in miles', () => {
		const reading = scaleBarFor(miles(2.5), 120, 120, 'imperial');

		expect(reading?.label).toBe('2 mi');
		expect(reading?.meters).toBeCloseTo(miles(2), 6);
		expect(reading?.widthPx).toBeCloseTo(96, 6);
	});

	it('keeps the meters canonical: the bar width is ground meters over meters per pixel', () => {
		const ground = 3_000;
		const pixels = 100;
		const reading = scaleBarFor(ground, pixels, 120, 'imperial')!;

		expect(reading.widthPx).toBeCloseTo(reading.meters / (ground / pixels), 9);
	});

	it('scales the bar by the measured pixels, not the maximum width', () => {
		const reading = scaleBarFor(miles(1), 100, 120, 'imperial');

		expect(reading?.label).toBe('1 mi');
		expect(reading?.widthPx).toBeCloseTo(100, 6);
	});

	it('keeps the bar between 40% and 100% of the maximum width at every scale', () => {
		for (let ground = 40; ground < 400_000; ground *= 1.37) {
			const reading = scaleBarFor(ground, 120, 120, 'imperial');
			expect(reading).toBeDefined();
			expect(reading!.widthPx).toBeLessThanOrEqual(120 + 1e-6);
			expect(reading!.widthPx).toBeGreaterThanOrEqual(120 * 0.4 - 1e-6);
		}
	});

	it('never words an awkward figure: every label is a whole 1, 2 or 5 times a power of ten', () => {
		for (let ground = 40; ground < 1_900_000; ground *= 1.13) {
			const label = scaleBarFor(ground, 120, 120, 'imperial')!.label;

			expect(label).toMatch(/^[\d,]+ (ft|mi)$/);
			expect(label.replace(/[ ,a-z]/g, '').replace(/0+$/, '')).toMatch(/^[125]$/);
		}
	});

	it('repeated calls in alternating systems never share state', () => {
		const first = scaleBarFor(750, 120, 120, 'metric');
		const imperial = scaleBarFor(750, 120, 120, 'imperial');
		const again = scaleBarFor(750, 120, 120, 'metric');

		expect(first).toEqual(again);
		expect(imperial?.label).toBe('2,000 ft');
		expect(first?.label).toBe('500 m');
	});

	it('hides the scale for invalid measurements and outside the shared range', () => {
		expect(scaleBarFor(Number.NaN, 120, 120, 'imperial')).toBeUndefined();
		expect(scaleBarFor(0, 120, 120, 'imperial')).toBeUndefined();
		expect(scaleBarFor(0.3, 120, 120, 'imperial')).toBeUndefined();
		expect(scaleBarFor(9_000_000, 120, 120, 'imperial')).toBeUndefined();
	});
});

describe('scale continuity across systems', () => {
	const systems = ['metric', 'imperial'] as const;
	const barFor = (maxMeters: number, system: (typeof systems)[number]) =>
		scaleBarFor(maxMeters, 100, 100, system);

	it('shows a bar in both systems or in neither over the whole measurable range', () => {
		for (let exponent = -1; exponent <= 7.5; exponent += 0.01) {
			const maxMeters = 10 ** exponent;
			expect(
				barFor(maxMeters, 'imperial') !== undefined,
				`${maxMeters} m of ground under the widest bar`
			).toBe(barFor(maxMeters, 'metric') !== undefined);
		}
	});

	it('keeps the imperial bar where its round steps are coarser than the metric ceiling', () => {
		const expected: Array<[number, string]> = [
			[2_000, '1,000 mi'],
			[3_218, '1,000 mi'],
			[3_220, '2,000 mi'],
			[4_000, '2,000 mi'],
			[4_999, '2,000 mi']
		];
		for (const [maxKm, label] of expected) {
			const reading = barFor(maxKm * 1000, 'imperial');
			expect(reading, `${maxKm} km`).toBeDefined();
			expect(reading!.label).toBe(label);
			expect(reading!.widthPx).toBeCloseTo(reading!.meters / (maxKm * 10), 6);
		}
	});

	it('hides both systems at the same span, whichever side of it the ground falls on', () => {
		for (const system of systems) {
			expect(barFor(4_999_000, system), system).toBeDefined();
			expect(barFor(5_000_000, system), system).toBeUndefined();
			expect(barFor(5_001_000, system), system).toBeUndefined();
		}
	});

	it('starts both systems at the same one meter floor', () => {
		for (const system of systems) {
			expect(barFor(0.999, system), system).toBeUndefined();
			expect(barFor(1, system), system).toBeDefined();
		}
	});

	it('never lets a bar exceed the widest allowed or shrink below 40% of it, in either system', () => {
		for (const system of systems) {
			for (let exponent = 0; exponent < 6.69; exponent += 0.01) {
				const reading = barFor(10 ** exponent, system)!;
				expect(reading.widthPx).toBeLessThanOrEqual(100 * (1 + 1e-9));
				expect(reading.widthPx).toBeGreaterThanOrEqual(40 * (1 - 1e-9));
			}
		}
	});

	it('keeps the imperial bar width equal to the ground it names at the mile and decade steps', () => {
		for (const ground of [miles(1), miles(2), miles(5), miles(1000), miles(2000), feet(5000)]) {
			const reading = barFor(ground, 'imperial')!;
			expect(reading.meters).toBeCloseTo(ground, 6);
			expect(reading.widthPx).toBeCloseTo(100, 6);
		}
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
