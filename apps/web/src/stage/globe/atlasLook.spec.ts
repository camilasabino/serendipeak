import { describe, expect, it } from 'vitest';
import {
	ATLAS_LOOK,
	advancePresentation,
	atlasLookAltitudeWeight,
	atlasLookIntensity,
	easePresentation,
	mix
} from './atlasLook';
import { atlasOverviewLook, overviewRangeMeters } from './atlasView';
import { TRANSITION_POLICY } from './transitionPlan';

describe('atlasLookAltitudeWeight', () => {
	it('is zero at and below the lower threshold, so terrain keeps its imagery', () => {
		expect(atlasLookAltitudeWeight(0)).toBe(0);
		expect(atlasLookAltitudeWeight(90_000)).toBe(0);
		expect(atlasLookAltitudeWeight(ATLAS_LOOK.absentBelowMeters)).toBe(0);
	});

	it('is one at and above the upper threshold', () => {
		expect(atlasLookAltitudeWeight(ATLAS_LOOK.fullAboveMeters)).toBe(1);
		expect(atlasLookAltitudeWeight(16_000_000)).toBe(1);
		expect(atlasLookAltitudeWeight(1e12)).toBe(1);
	});

	it('is one across every overview the atlas frames, wide stage or narrow', () => {
		for (const stage of [
			{ width: 1440, height: 900 },
			{ width: 768, height: 1024 },
			{ width: 390, height: 844 },
			undefined
		]) {
			expect(atlasLookAltitudeWeight(overviewRangeMeters(stage))).toBe(1);
		}
	});

	it('rises smoothly and never falls as the camera climbs', () => {
		let previous = 0;
		let largestStep = 0;
		for (let height = 900_000; height <= 7_000_000; height += 25_000) {
			const weight = atlasLookAltitudeWeight(height);
			expect(weight).toBeGreaterThanOrEqual(previous);
			largestStep = Math.max(largestStep, weight - previous);
			previous = weight;
		}
		expect(largestStep).toBeLessThan(0.02);
	});

	it('is half way at the geometric mean of the thresholds', () => {
		const middle = Math.sqrt(ATLAS_LOOK.absentBelowMeters * ATLAS_LOOK.fullAboveMeters);

		expect(atlasLookAltitudeWeight(middle)).toBeCloseTo(0.5, 10);
	});

	it('allows nothing for a height that cannot be read', () => {
		expect(atlasLookAltitudeWeight(Number.NaN)).toBe(0);
		expect(atlasLookAltitudeWeight(-5)).toBe(0);
		expect(atlasLookAltitudeWeight(Number.POSITIVE_INFINITY)).toBe(0);
	});
});

describe('atlasLookIntensity', () => {
	it('is the presentation times the altitude weight', () => {
		const middle = Math.sqrt(ATLAS_LOOK.absentBelowMeters * ATLAS_LOOK.fullAboveMeters);

		expect(atlasLookIntensity(1, 16_000_000)).toBe(1);
		expect(atlasLookIntensity(1, middle)).toBeCloseTo(0.5, 10);
		expect(atlasLookIntensity(0.5, middle)).toBeCloseTo(0.25, 10);
		expect(atlasLookIntensity(1, 90_000)).toBe(0);
		expect(atlasLookIntensity(0, 16_000_000)).toBe(0);
	});

	it('is exactly zero below one step, so the original scene returns exactly', () => {
		expect(atlasLookIntensity(1, ATLAS_LOOK.absentBelowMeters * 1.0001)).toBe(0);
		expect(atlasLookIntensity(0.01, 16_000_000)).toBe(0);
	});

	it('does not let an out-of-range presentation overshoot', () => {
		expect(atlasLookIntensity(3, 16_000_000)).toBe(1);
		expect(atlasLookIntensity(-1, 16_000_000)).toBe(0);
	});
});

describe('the presentation fade', () => {
	it('eases with no hard ends', () => {
		expect(easePresentation(0)).toBe(0);
		expect(easePresentation(1)).toBe(1);
		expect(easePresentation(0.5)).toBe(0.5);
		expect(easePresentation(0.1)).toBeLessThan(0.1);
		expect(easePresentation(0.9)).toBeGreaterThan(0.9);
	});

	it('takes the fade duration end to end, in either direction', () => {
		let progress = 0;
		for (let frame = 0; frame < 6; frame += 1) {
			progress = advancePresentation(progress, 1, ATLAS_LOOK.fadeSeconds / 7);
		}
		expect(progress).toBeCloseTo(6 / 7, 10);
		expect(advancePresentation(progress, 1, ATLAS_LOOK.fadeSeconds / 5)).toBe(1);
		expect(advancePresentation(1, 0, ATLAS_LOOK.fadeSeconds / 2)).toBeCloseTo(0.5, 10);
		expect(advancePresentation(0.2, 0, ATLAS_LOOK.fadeSeconds)).toBe(0);
	});

	it('stays put for no time and never runs backwards for a negative one', () => {
		expect(advancePresentation(0.4, 1, 0)).toBe(0.4);
		expect(advancePresentation(0.4, 1, -1)).toBe(0.4);
		expect(advancePresentation(0.4, 0, -1)).toBe(0.4);
	});

	it('finishes before the quickest mountain flight lands', () => {
		expect(ATLAS_LOOK.fadeSeconds).toBeLessThan(TRANSITION_POLICY.pace.minSeconds);
	});
});

describe('mix', () => {
	it('returns each end exactly and interpolates between', () => {
		expect(mix(1, 0.65, 0)).toBe(1);
		expect(mix(1, 0.65, 1)).toBe(0.65);
		expect(mix(1, 0.5, 0.5)).toBe(0.75);
	});
});

describe('the look at full strength', () => {
	it('is the B2 recipe', () => {
		expect(ATLAS_LOOK.layer).toEqual({ saturation: 0.65, brightness: 0.85, contrast: 1.1 });
		expect(ATLAS_LOOK.skyAtmosphere).toEqual({ saturationShift: -0.6, brightnessShift: -0.35 });
		expect(ATLAS_LOOK.groundAtmosphere).toEqual({ saturationShift: -0.6, brightnessShift: -0.2 });
		expect(ATLAS_LOOK.background.red).toBeCloseTo(0x11 / 255, 10);
		expect(ATLAS_LOOK.background.green).toBeCloseTo(0x0f / 255, 10);
		expect(ATLAS_LOOK.background.blue).toBeCloseTo(0x0e / 255, 10);
	});

	it('keeps the overview inside the full-strength range for the stage the atlas frames', () => {
		const look = atlasOverviewLook({ center: { latitude: 20, longitude: 10 } }, undefined);

		expect(look.rangeMeters).toBeGreaterThan(ATLAS_LOOK.fullAboveMeters);
	});
});
