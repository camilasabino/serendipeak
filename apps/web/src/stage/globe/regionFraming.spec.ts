import { describe, expect, it } from 'vitest';
import { ATLAS_MARKER_STYLE, markerPresentation } from './atlasMarkers';
import { CESIUM_DEFAULT_FOV_RADIANS } from './framing';
import {
	EARTH_MEAN_RADIUS_METERS,
	cross,
	dot,
	normalize,
	unitVector,
	type GeoPoint
} from './geodesic';
import { REGION_FRAMING, frameRegion, type RegionFraming } from './regionFraming';
import { stageAspect, type StageSize } from './stageFrame';

const DESKTOP: StageSize = { width: 1280, height: 800 };
const PHONE: StageSize = { width: 390, height: 700 };
const WHOLE_GLOBE = 40_000_000;

const ACONCAGUA: GeoPoint = { latitude: -32.653, longitude: -70.011 };
const FITZ_ROY: GeoPoint = { latitude: -49.271, longitude: -73.043 };
const CERRO_TORRE: GeoPoint = { latitude: -49.293, longitude: -73.105 };
const LLULLAILLACO: GeoPoint = { latitude: -24.717, longitude: -68.541 };
const DENALI: GeoPoint = { latitude: 63.069, longitude: -151.007 };
const KILIMANJARO: GeoPoint = { latitude: -3.076, longitude: 37.353 };
const EVEREST: GeoPoint = { latitude: 27.988, longitude: 86.925 };
const MONT_BLANC: GeoPoint = { latitude: 45.833, longitude: 6.865 };
const OJOS_DEL_SALADO: GeoPoint = { latitude: -27.109, longitude: -68.541 };

function frame(places: GeoPoint[], stage: StageSize | undefined = DESKTOP, max = WHOLE_GLOBE) {
	const framing = frameRegion(places, stage, max);
	expect(framing).toBeDefined();
	return framing!;
}

// An independent reading of the same geometry: where the camera sees a place, as a share of the
// half-extent of its side of the stage. 1 is the edge of the stage; the framing keeps within 1 - margin.
function screenShare(place: GeoPoint, framing: RegionFraming, stage: StageSize) {
	const up = unitVector(framing.center);
	const rawEast = cross([0, 0, 1], up);
	const east = Math.hypot(...rawEast) > 1e-9 ? normalize(rawEast) : ([0, 1, 0] as const);
	const north = cross(up, [...east]);
	const v = unitVector(place);
	const distance = 1 + framing.altitudeMeters / EARTH_MEAN_RADIUS_METERS;
	const depth = distance - dot(v, up);
	const wide = Math.tan(CESIUM_DEFAULT_FOV_RADIANS / 2);
	const aspect = stageAspect(stage);
	const reachX = aspect >= 1 ? wide : wide * aspect;
	const reachY = aspect >= 1 ? wide / aspect : wide;

	return {
		x: Math.abs(dot(v, [...east])) / depth / reachX,
		y: Math.abs(dot(v, north)) / depth / reachY,
		visible: dot(v, up) * distance > 1
	};
}

function widest(places: GeoPoint[], framing: RegionFraming, stage: StageSize): number {
	return Math.max(
		...places.map((place) => {
			const { x, y } = screenShare(place, framing, stage);
			return Math.max(x, y);
		})
	);
}

describe('frameRegion', () => {
	const ANDES = [LLULLAILLACO, ACONCAGUA, FITZ_ROY];

	it('has nothing to frame without places', () => {
		expect(frameRegion([], DESKTOP, WHOLE_GLOBE)).toBeUndefined();
	});

	it('centres on a single mountain without closing in on it', () => {
		const framing = frame([ACONCAGUA]);

		expect(framing.center.latitude).toBeCloseTo(ACONCAGUA.latitude, 6);
		expect(framing.center.longitude).toBeCloseTo(ACONCAGUA.longitude, 6);
		expect(framing.altitudeMeters).toBe(REGION_FRAMING.minAltitudeMeters);
	});

	it('keeps neighbouring summits a few kilometres apart at the same regional distance', () => {
		const pair = frame([FITZ_ROY, CERRO_TORRE]);

		expect(pair.altitudeMeters).toBe(REGION_FRAMING.minAltitudeMeters);
		expect(pair.center.latitude).toBeCloseTo((FITZ_ROY.latitude + CERRO_TORRE.latitude) / 2, 2);
	});

	it.each([
		['desktop', DESKTOP],
		['phone', PHONE],
		['a short, wide stage', { width: 900, height: 360 }]
	])(
		'keeps every place inside the margin on %s, and fills it for the outermost',
		(_name, stage) => {
			const framing = frame(ANDES, stage);

			expect(widest(ANDES, framing, stage)).toBeCloseTo(1 - REGION_FRAMING.margin, 6);
			for (const place of ANDES) {
				expect(screenShare(place, framing, stage).visible).toBe(true);
			}
		}
	);

	it('does not centre on the arithmetic mean of coordinates', () => {
		const lopsided = [ACONCAGUA, LLULLAILLACO, { latitude: -24.9, longitude: -68.4 }, FITZ_ROY];
		const meanLatitude = lopsided.reduce((total, { latitude }) => total + latitude, 0) / 4;

		const framing = frame(lopsided);

		// Centred on the extent of the places, not on where most of them lie.
		expect(framing.center.latitude).toBeCloseTo((FITZ_ROY.latitude + -24.717) / 2, 0);
		expect(Math.abs(framing.center.latitude - meanLatitude)).toBeGreaterThan(3);
	});

	it('stands higher over a tall stage for a set that runs across it, and lower over a wide one', () => {
		const eastWest = [
			{ latitude: -33, longitude: -75 },
			{ latitude: -33, longitude: -55 }
		];
		const northSouth = [
			{ latitude: -20, longitude: -68 },
			{ latitude: -50, longitude: -68 }
		];

		expect(frame(eastWest, PHONE).altitudeMeters).toBeGreaterThan(
			frame(eastWest, DESKTOP).altitudeMeters
		);
		expect(frame(northSouth, DESKTOP).altitudeMeters).toBeGreaterThan(
			frame(northSouth, PHONE).altitudeMeters
		);
	});

	it('treats an unmeasured stage as a square one', () => {
		const square = { width: 500, height: 500 };

		const unmeasured = frameRegion(ANDES, undefined, WHOLE_GLOBE);

		expect(unmeasured).toEqual(frame(ANDES, square));
		expect(frameRegion(ANDES, { width: 0, height: 0 }, WHOLE_GLOBE)).toEqual(unmeasured);
	});

	it('is the same whichever way round the places arrive', () => {
		const forward = frame(ANDES);
		const backward = frame([...ANDES].reverse());

		expect(backward.altitudeMeters).toBeCloseTo(forward.altitudeMeters, 3);
		expect(backward.center.latitude).toBeCloseTo(forward.center.latitude, 9);
		expect(backward.center.longitude).toBeCloseTo(forward.center.longitude, 9);
	});

	describe('across the antimeridian', () => {
		const east = [
			{ latitude: -17.6, longitude: 179.3 },
			{ latitude: -16.9, longitude: -179.4 },
			{ latitude: -18.2, longitude: 178.4 }
		];

		it('centres on the side of the line the places gather on, not on the far meridian', () => {
			const framing = frame(east);

			expect(Math.abs(framing.center.longitude)).toBeGreaterThan(178);
			expect(framing.center.latitude).toBeCloseTo(-17.55, 0);
		});

		it('frames them exactly as it frames the same places elsewhere on the globe', () => {
			const shifted = east.map(({ latitude, longitude }) => ({
				latitude,
				longitude: ((longitude + 180 + 180) % 360) - 180
			}));

			const framing = frame(east);
			const elsewhere = frame(shifted);

			expect(framing.altitudeMeters).toBeCloseTo(elsewhere.altitudeMeters, 3);
			expect(framing.center.latitude).toBeCloseTo(elsewhere.center.latitude, 6);
		});

		it('keeps every place inside the margin', () => {
			const framing = frame(east, PHONE);

			expect(widest(east, framing, PHONE)).toBeLessThanOrEqual(1 - REGION_FRAMING.margin + 1e-9);
		});
	});

	describe('over a pole', () => {
		it('frames a place at the pole itself', () => {
			const framing = frame([{ latitude: 90, longitude: 0 }]);

			expect(framing.center.latitude).toBeCloseTo(90, 6);
			expect(Number.isFinite(framing.center.longitude)).toBe(true);
		});

		it('frames places on opposite sides of the pole', () => {
			const around = [
				{ latitude: 85, longitude: 0 },
				{ latitude: 85, longitude: 180 }
			];

			const framing = frame(around);

			expect(framing.center.latitude).toBeGreaterThan(88);
			expect(framing.altitudeMeters).toBeLessThan(WHOLE_GLOBE);
			expect(widest(around, framing, DESKTOP)).toBeCloseTo(1 - REGION_FRAMING.margin, 6);
		});
	});

	describe('for places spread across the globe', () => {
		it('keeps the whole globe in view, turned toward them, rather than closing in', () => {
			const framing = frame([DENALI, KILIMANJARO, EVEREST, ACONCAGUA]);

			expect(framing.altitudeMeters).toBe(WHOLE_GLOBE);
			expect(Number.isFinite(framing.center.latitude)).toBe(true);
			expect(Number.isFinite(framing.center.longitude)).toBe(true);
		});

		it('does not stand further out than the ceiling it is given', () => {
			const wide = [MONT_BLANC, EVEREST];

			expect(frame(wide, DESKTOP, 1_000_000).altitudeMeters).toBe(1_000_000);
		});

		it('has no centre for places that cancel out', () => {
			const opposite = [
				{ latitude: 10, longitude: 20 },
				{ latitude: -10, longitude: -160 }
			];

			expect(frameRegion(opposite, DESKTOP, WHOLE_GLOBE)).toBeUndefined();
		});

		it('frames a continental spread closely enough to be worth framing', () => {
			const europe = [
				MONT_BLANC,
				{ latitude: 43.35, longitude: 42.44 },
				{ latitude: 60, longitude: 7 }
			];

			const framing = frame(europe);

			expect(framing.altitudeMeters).toBeGreaterThan(REGION_FRAMING.minAltitudeMeters);
			expect(framing.altitudeMeters).toBeLessThan(WHOLE_GLOBE / 2);
		});
	});

	describe('with coordinates that cannot be placed', () => {
		it.each([
			['not a number', { latitude: Number.NaN, longitude: 10 }],
			['infinite', { latitude: 10, longitude: Number.POSITIVE_INFINITY }],
			['beyond a pole', { latitude: 95, longitude: 10 }]
		])('ignores a place that is %s', (_name, bad) => {
			expect(frame([ACONCAGUA, bad])).toEqual(frame([ACONCAGUA]));
		});

		it('has nothing to frame when no place is usable', () => {
			expect(
				frameRegion([{ latitude: Number.NaN, longitude: 0 }], DESKTOP, WHOLE_GLOBE)
			).toBeUndefined();
		});
	});
});

// A filter leaves the camera where the frame puts it, and the frame depends on the stage's shape, so
// the names of what it frames must be opaque across the stages a desktop browser gives the atlas.
describe('framing a result set against atlas label legibility', () => {
	const STAGES: [string, StageSize][] = [
		['a tall desktop stage', { width: 1037, height: 787 }],
		['a laptop stage', { width: 1037, height: 587 }],
		['a short, wide stage', { width: 1037, height: 507 }]
	];

	it.each(STAGES)('keeps two mountains 700 km apart fully named on %s', (_name, stage) => {
		const { altitudeMeters } = frame([ACONCAGUA, OJOS_DEL_SALADO], stage);
		const slantMeters = altitudeMeters * 1.03;

		expect(markerPresentation(slantMeters).labelAlpha).toBe(1);
		expect(slantMeters).toBeLessThan(ATLAS_MARKER_STYLE.labelFullMeters);
	});
});
