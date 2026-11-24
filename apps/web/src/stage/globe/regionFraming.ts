import { CESIUM_DEFAULT_FOV_RADIANS } from './framing';
import {
	EARTH_MEAN_RADIUS_METERS,
	cross,
	dot,
	geoPoint,
	normalize,
	unitVector,
	type GeoPoint,
	type Vector
} from './geodesic';
import { stageAspect, type StageSize } from './stageFrame';

/** Where a camera looking straight down must stand to show a set of places. */
export interface RegionFraming {
	center: GeoPoint;
	altitudeMeters: number;
}

export const REGION_FRAMING = {
	/**
	 * A single mountain, or a handful a few kilometres apart, gets this much sky rather than a
	 * close-up: the atlas orients, and a summit's own camera is the mountain page's job. Inside the
	 * distance where atlas names are fully legible.
	 */
	minAltitudeMeters: 1_000_000,
	/** The share of each half-extent of the stage left clear around the outermost places. */
	margin: 0.22,
	/**
	 * A place whose direction is further than this from the centre sits too near the horizon to be
	 * framed by a camera that looks straight down: the set is treated as dispersed.
	 */
	maxSpreadDegrees: 70,
	centeringPasses: 4
} as const;

const MAX_SPREAD_COSINE = Math.cos((REGION_FRAMING.maxSpreadDegrees * Math.PI) / 180);
const DEGENERATE_LENGTH = 1e-9;

/** The tangent of the half-angle Cesium's field of view spans across each side of the stage. */
function viewHalfTangents(stage: StageSize | undefined): { x: number; y: number } {
	const aspect = stage ? stageAspect(stage) : 0;
	const wide = Math.tan(CESIUM_DEFAULT_FOV_RADIANS / 2);
	// Cesium applies its field of view to the wider side.
	if (!(aspect > 0) || aspect === 1) {
		return { x: wide, y: wide };
	}

	return aspect > 1 ? { x: wide, y: wide / aspect } : { x: wide * aspect, y: wide };
}

function isUsable({ latitude, longitude }: GeoPoint): boolean {
	return Number.isFinite(latitude) && Number.isFinite(longitude) && Math.abs(latitude) <= 90;
}

function sum(vectors: readonly Vector[]): Vector {
	const total: Vector = [0, 0, 0];
	for (const [x, y, z] of vectors) {
		total[0] += x;
		total[1] += y;
		total[2] += z;
	}

	return total;
}

interface TangentBasis {
	east: Vector;
	north: Vector;
	up: Vector;
}

// North is up on screen, so the frame is the local east-north-up of the centre.
function tangentBasis(up: Vector): TangentBasis {
	const eastward = cross([0, 0, 1], up);
	const east =
		Math.hypot(...eastward) > DEGENERATE_LENGTH ? normalize(eastward) : ([0, 1, 0] as Vector);

	return { east, north: cross(up, east), up };
}

function localOffset(basis: TangentBasis, place: Vector): Vector {
	return [dot(place, basis.east), dot(place, basis.north), dot(place, basis.up)];
}

function offsetBy(basis: TangentBasis, eastTangent: number, northTangent: number): Vector {
	const { east, north, up } = basis;

	return normalize([
		up[0] + east[0] * eastTangent + north[0] * northTangent,
		up[1] + east[1] * eastTangent + north[1] * northTangent,
		up[2] + east[2] * eastTangent + north[2] * northTangent
	]);
}

/**
 * Where to put the camera so that every place is on screen with `REGION_FRAMING.margin` to spare,
 * looking straight down with north up. Places are unit vectors, never longitudes and latitudes, so
 * the antimeridian and the poles need no special case.
 *
 * The centre starts at the direction of the vectors' sum and is then moved to the middle of the
 * angular extent of the places across and along the screen, so a lopsided set (Chile's long coast,
 * a country with a far island) is centred on what it covers rather than on where most of it lies.
 * The height follows from the exact condition for each place: at distance D from the globe's
 * centre, a place at offset (e, n) and height u along the view axis is inside the frustum when
 * e / (D - u) and n / (D - u) stay within the field of view of their side, reduced by the margin.
 * O(p) for p places, with a constant number of passes.
 *
 * A set too spread out to frame from above (some place lies beyond `maxSpreadDegrees` of its centre)
 * keeps that centre and the whole globe, `maxAltitudeMeters`, rather than a close frame that would
 * push the outer places to the horizon. Returns undefined when no place has valid coordinates, or
 * when the places cancel out and leave no direction to look at.
 */
export function frameRegion(
	places: readonly GeoPoint[],
	stage: StageSize | undefined,
	maxAltitudeMeters: number
): RegionFraming | undefined {
	const vectors = places.filter(isUsable).map(unitVector);
	if (vectors.length === 0) {
		return undefined;
	}

	const total = sum(vectors);
	if (Math.hypot(...total) < DEGENERATE_LENGTH) {
		return undefined;
	}

	let center = normalize(total);
	for (let pass = 0; pass < REGION_FRAMING.centeringPasses; pass += 1) {
		const basis = tangentBasis(center);
		const offsets = vectors.map((place) => localOffset(basis, place));
		if (offsets.some(([, , up]) => up <= MAX_SPREAD_COSINE)) {
			return { center: geoPoint(center), altitudeMeters: maxAltitudeMeters };
		}

		const eastAngles = offsets.map(([east, , up]) => Math.atan2(east, up));
		const northAngles = offsets.map(([, north, up]) => Math.atan2(north, up));
		const midEast = (Math.min(...eastAngles) + Math.max(...eastAngles)) / 2;
		const midNorth = (Math.min(...northAngles) + Math.max(...northAngles)) / 2;
		center = offsetBy(basis, Math.tan(midEast), Math.tan(midNorth));
	}

	const basis = tangentBasis(center);
	const reach = viewHalfTangents(stage);
	const kept = 1 - REGION_FRAMING.margin;
	const radius = EARTH_MEAN_RADIUS_METERS;
	let distance = 1;
	for (const place of vectors) {
		const [east, north, up] = localOffset(basis, place);
		if (up <= MAX_SPREAD_COSINE) {
			return { center: geoPoint(center), altitudeMeters: maxAltitudeMeters };
		}
		distance = Math.max(
			distance,
			up + Math.abs(east) / (reach.x * kept),
			up + Math.abs(north) / (reach.y * kept)
		);
	}

	const altitudeMeters = (distance - 1) * radius;

	return {
		center: geoPoint(center),
		altitudeMeters: Math.min(
			maxAltitudeMeters,
			Math.max(REGION_FRAMING.minAltitudeMeters, altitudeMeters)
		)
	};
}
