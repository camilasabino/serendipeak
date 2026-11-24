import { describe, expect, it } from 'vitest';
import {
	ATLAS_VIEW,
	atlasOverviewLook,
	overviewRangeMeters,
	sameAtlasFocus,
	sameAtlasView,
	type AtlasView
} from './atlasView';
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

const ARGENTINA: AtlasView = {
	...ATLAS_VIEW,
	focus: [
		{ latitude: -32.653, longitude: -70.011 },
		{ latitude: -49.271, longitude: -73.043 },
		{ latitude: -24.717, longitude: -68.541 }
	]
};

describe('atlasOverviewLook with a focus', () => {
	const DESKTOP = { width: 1280, height: 800 };
	const PHONE = { width: 390, height: 700 };

	it('is the overview when there is no focus, whatever else the view holds', () => {
		expect(atlasOverviewLook({ ...ATLAS_VIEW, focus: undefined }, DESKTOP)).toEqual(
			atlasOverviewLook(ATLAS_VIEW, DESKTOP)
		);
	});

	it('looks down at the centre of the places from closer than the overview', () => {
		const look = atlasOverviewLook(ARGENTINA, DESKTOP);

		expect(look.latitude).toBeCloseTo(-37, 0);
		expect(look.longitude).toBeCloseTo(-70.4, 0);
		expect(look.rangeMeters).toBeLessThan(overviewRangeMeters(DESKTOP));
		expect(look.pitchDegrees).toBe(TRANSITION_POLICY.globe.pitchDegrees);
		expect(look.headingDegrees).toBe(TRANSITION_POLICY.globe.headingDegrees);
		expect(look.altitudeMeters).toBe(0);
	});

	it('keeps north up and the place centred, as the overview does', () => {
		const look = atlasOverviewLook(ARGENTINA, PHONE);

		expect(look.headingDegrees).toBe(0);
		expect(look.framingX).toBe(0);
		expect(look.framingY).toBe(0);
	});

	it('fits the side of the stage a set runs along, so a long north-south country needs more room on a wide stage', () => {
		expect(atlasOverviewLook(ARGENTINA, DESKTOP).rangeMeters).toBeGreaterThan(
			atlasOverviewLook(ARGENTINA, PHONE).rangeMeters
		);
	});

	it('measures the range along the line of sight, which is a degree off the vertical', () => {
		const look = atlasOverviewLook(
			{ ...ATLAS_VIEW, focus: [{ latitude: -33, longitude: -70 }] },
			DESKTOP
		);

		expect(look.rangeMeters * Math.sin((89 * Math.PI) / 180)).toBeCloseTo(1_000_000, 3);
	});

	it('never stands further out than the overview, which keeps a dispersed set in view whole', () => {
		const dispersed: AtlasView = {
			...ATLAS_VIEW,
			focus: [
				{ latitude: 63, longitude: -151 },
				{ latitude: -3, longitude: 37 },
				{ latitude: 28, longitude: 87 },
				{ latitude: -33, longitude: -70 }
			]
		};

		const look = atlasOverviewLook(dispersed, DESKTOP);

		expect(look.rangeMeters).toBe(overviewRangeMeters(DESKTOP));
		expect(look.latitude).not.toBe(ATLAS_VIEW.center.latitude);
	});

	it('falls back to the overview when no place can give a centre', () => {
		const unplaceable: AtlasView = {
			...ATLAS_VIEW,
			focus: [{ latitude: Number.NaN, longitude: 0 }]
		};

		expect(atlasOverviewLook(unplaceable, DESKTOP)).toEqual(atlasOverviewLook(ATLAS_VIEW, DESKTOP));
	});
});

describe('sameAtlasFocus', () => {
	const A = { latitude: 1, longitude: 2 };
	const B = { latitude: 3, longitude: 4 };

	it('compares the places in order, by value', () => {
		expect(sameAtlasFocus([A, B], [{ ...A }, { ...B }])).toBe(true);
		expect(sameAtlasFocus([A, B], [B, A])).toBe(false);
		expect(sameAtlasFocus([A], [A, B])).toBe(false);
		expect(sameAtlasFocus([A], [{ latitude: 1, longitude: 2.0001 }])).toBe(false);
	});

	it('treats no focus as its own case, apart from an empty one', () => {
		expect(sameAtlasFocus(undefined, undefined)).toBe(true);
		expect(sameAtlasFocus(undefined, [A])).toBe(false);
		expect(sameAtlasFocus([], undefined)).toBe(false);
	});
});

describe('sameAtlasView', () => {
	it('compares by center', () => {
		expect(sameAtlasView(ATLAS_VIEW, { center: { ...ATLAS_VIEW.center } })).toBe(true);
		expect(sameAtlasView(ATLAS_VIEW, { center: { latitude: 0, longitude: 0 } })).toBe(false);
		expect(sameAtlasView(undefined, undefined)).toBe(true);
		expect(sameAtlasView(ATLAS_VIEW, undefined)).toBe(false);
	});

	it('compares by the places it frames', () => {
		const copy = { ...ARGENTINA, focus: ARGENTINA.focus!.map((place) => ({ ...place })) };

		expect(sameAtlasView(ARGENTINA, copy)).toBe(true);
		expect(sameAtlasView(ARGENTINA, ATLAS_VIEW)).toBe(false);
		expect(sameAtlasView(ATLAS_VIEW, ARGENTINA)).toBe(false);
		expect(sameAtlasView(ARGENTINA, { ...ARGENTINA, focus: ARGENTINA.focus!.slice(1) })).toBe(
			false
		);
	});
});
