import { describe, expect, it } from 'vitest';
import { ATLAS_VIEW, atlasOverviewLook, overviewRangeMeters, sameAtlasView } from './atlasView';
import { CESIUM_DEFAULT_FOV_RADIANS } from './framing';
import { TRANSITION_POLICY } from './transitionPlan';

const EARTH_RADIUS_METERS = 6_371_000;

// The angle the globe subtends across the stage's narrower side, seen from the overview.
function globeShare(stage: { width: number; height: number }): number {
	const distance = EARTH_RADIUS_METERS + overviewRangeMeters(stage);
	const globeHalfAngle = Math.asin(EARTH_RADIUS_METERS / distance);
	const narrow = Math.min(stage.width, stage.height) / Math.max(stage.width, stage.height);
	const viewHalfAngle = Math.atan(Math.tan(CESIUM_DEFAULT_FOV_RADIANS / 2) * narrow);
	return Math.tan(globeHalfAngle) / Math.tan(viewHalfAngle);
}

describe('atlasOverviewLook', () => {
	it('always looks down on the same editorial point, whatever the stage', () => {
		for (const stage of [
			{ width: 1280, height: 800 },
			{ width: 375, height: 480 }
		]) {
			const look = atlasOverviewLook(ATLAS_VIEW, stage);

			expect(look.latitude).toBe(ATLAS_VIEW.center.latitude);
			expect(look.longitude).toBe(ATLAS_VIEW.center.longitude);
			expect(look.altitudeMeters).toBe(0);
			expect(look.pitchDegrees).toBe(TRANSITION_POLICY.globe.pitchDegrees);
			expect(look.headingDegrees).toBe(TRANSITION_POLICY.globe.headingDegrees);
		}
	});

	it.each([
		['a wide desktop stage', { width: 1280, height: 720 }],
		['a square stage', { width: 700, height: 700 }],
		['a tall phone stage', { width: 320, height: 500 }],
		['a short phone stage', { width: 430, height: 288 }]
	])('fits the whole globe inside %s with a margin', (_name, stage) => {
		const share = globeShare(stage);

		expect(share).toBeLessThan(1);
		expect(share).toBeGreaterThan(0.8);
	});

	it('moves further away for a narrower stage', () => {
		expect(overviewRangeMeters({ width: 320, height: 640 })).toBeGreaterThan(
			overviewRangeMeters({ width: 800, height: 640 })
		);
	});

	it('falls back to a square stage when the stage is not measured yet', () => {
		expect(overviewRangeMeters(undefined)).toBe(overviewRangeMeters({ width: 1, height: 1 }));
		expect(overviewRangeMeters({ width: 0, height: 0 })).toBe(overviewRangeMeters(undefined));
	});
});

describe('sameAtlasView', () => {
	it('compares by center', () => {
		expect(sameAtlasView(ATLAS_VIEW, { center: { ...ATLAS_VIEW.center } })).toBe(true);
		expect(sameAtlasView(ATLAS_VIEW, { center: { latitude: 0, longitude: 0 } })).toBe(false);
		expect(sameAtlasView(undefined, undefined)).toBe(true);
		expect(sameAtlasView(ATLAS_VIEW, undefined)).toBe(false);
	});
});
