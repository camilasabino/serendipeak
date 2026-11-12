import { CESIUM_DEFAULT_FOV_RADIANS } from './framing';
import type { LookState } from './glidePath';
import { stageAspect, type StageSize } from './stageFrame';
import { globeLook } from './transitionPlan';

export interface GeoPoint {
	latitude: number;
	longitude: number;
}

/** What the stage needs to know about the atlas: the point its overview looks down on. */
export interface AtlasView {
	center: GeoPoint;
}

/**
 * The editorial overview: Europe and Africa face the reader, with the Americas next as the globe
 * turns. Fixed rather than derived from the catalog, so the atlas always opens on the same globe.
 */
export const ATLAS_VIEW: AtlasView = { center: { latitude: 20, longitude: 10 } };

/** One full ambient turn of the overview. Slow enough to read as drift, not as travel. */
export const ATLAS_ORBIT_PERIOD_SECONDS = 300;

const EARTH_RADIUS_METERS = 6_371_000;
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
	const distanceFromCenter = EARTH_RADIUS_METERS / (GLOBE_FILL * Math.sin(halfAngle));

	return distanceFromCenter - EARTH_RADIUS_METERS;
}

export function atlasOverviewLook(view: AtlasView, stage: StageSize | undefined): LookState {
	return {
		...globeLook({ ...view.center, altitudeMeters: 0 }),
		rangeMeters: overviewRangeMeters(stage)
	};
}

export function sameAtlasView(a: AtlasView | undefined, b: AtlasView | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}

	return a.center.latitude === b.center.latitude && a.center.longitude === b.center.longitude;
}
