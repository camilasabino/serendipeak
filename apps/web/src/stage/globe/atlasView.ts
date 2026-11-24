import { CESIUM_DEFAULT_FOV_RADIANS } from './framing';
import type { LookState } from './glidePath';
import { EARTH_MEAN_RADIUS_METERS, type GeoPoint } from './geodesic';
import { frameRegion } from './regionFraming';
import { stageAspect, type StageSize } from './stageFrame';
import { globeLook } from './transitionPlan';

export type { GeoPoint };

/**
 * What the stage needs to know about the atlas: the point its overview looks down on and, while the
 * reader's geographic filters narrow the catalog, the places they leave. Those places are framed in
 * place of the overview, wherever the stage's shape puts the camera; they are never the markers
 * drawn, which change with every filter.
 */
export interface AtlasView {
	center: GeoPoint;
	focus?: readonly GeoPoint[];
}

/**
 * The editorial overview: Europe and Africa face the reader, with the Americas next as the globe
 * turns. Fixed rather than derived from the catalog, so the atlas always opens on the same globe.
 */
export const ATLAS_VIEW: AtlasView = { center: { latitude: 20, longitude: 10 } };

/** One full ambient turn of the overview. Slow enough to read as drift, not as travel. */
export const ATLAS_ORBIT_PERIOD_SECONDS = 300;

// The globe's width as a share of the stage's narrower side, leaving a margin of sky around it.
const GLOBE_FILL = 0.88;

/**
 * How far above the surface the whole globe fits the stage. Cesium applies its field of view to
 * the wider side, so the narrower side sees less and decides the distance.
 */
export function overviewRangeMeters(stage: StageSize | undefined): number {
	const aspect = stage ? stageAspect(stage) : 0;
	const narrowSide = aspect > 0 ? Math.min(aspect, 1 / aspect) : 1;
	const halfAngle = Math.atan(Math.tan(CESIUM_DEFAULT_FOV_RADIANS / 2) * narrowSide);
	const distanceFromCenter = EARTH_MEAN_RADIUS_METERS / (GLOBE_FILL * Math.sin(halfAngle));

	return distanceFromCenter - EARTH_MEAN_RADIUS_METERS;
}

/**
 * The look the atlas camera rests at: the framing of its focus when it has one, otherwise the
 * overview. A focus too dispersed to frame closely keeps the whole globe in view, turned toward it.
 */
export function atlasOverviewLook(view: AtlasView, stage: StageSize | undefined): LookState {
	const overviewRange = overviewRangeMeters(stage);
	const framing = view.focus && frameRegion(view.focus, stage, overviewRange);
	if (!framing) {
		return {
			...globeLook({ ...view.center, altitudeMeters: 0 }),
			rangeMeters: overviewRange
		};
	}

	const look = globeLook({ ...framing.center, altitudeMeters: 0 });
	// The look's range runs along its line of sight, which is a degree off the vertical.
	const range = framing.altitudeMeters / Math.abs(Math.sin((look.pitchDegrees * Math.PI) / 180));

	return { ...look, rangeMeters: Math.min(overviewRange, range) };
}

function sameGeoPoint(a: GeoPoint, b: GeoPoint): boolean {
	return a.latitude === b.latitude && a.longitude === b.longitude;
}

/** The same places in the same order, or neither has any. */
export function sameAtlasFocus(
	a: readonly GeoPoint[] | undefined,
	b: readonly GeoPoint[] | undefined
): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}

	return a.length === b.length && a.every((place, index) => sameGeoPoint(place, b[index]!));
}

export function sameAtlasView(a: AtlasView | undefined, b: AtlasView | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}

	return sameGeoPoint(a.center, b.center) && sameAtlasFocus(a.focus, b.focus);
}
