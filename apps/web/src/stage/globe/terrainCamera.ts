import { resolvedFraming, type CameraFraming } from './framing';
import { viewpointBearingDegrees } from './orientation';

export interface GeographicPosition {
	latitude: number;
	longitude: number;
}

export interface TerrainHeightSource {
	sampleHeights(positions: readonly GeographicPosition[]): Promise<readonly (number | undefined)[]>;
}

export interface EditorialCamera {
	headingDegrees: number;
	pitchDegrees: number;
	rangeMeters: number;
	framing?: CameraFraming;
}

export interface TerrainCameraQuery {
	slug: string;
	latitude: number;
	longitude: number;
	elevationMeters: number;
	stageWidth: number;
	stageHeight: number;
	terrain: TerrainHeightSource | null;
	camera?: EditorialCamera;
}

export interface TerrainCameraPose {
	headingDegrees: number;
	pitchDegrees: number;
	rollDegrees: number;
	rangeMeters: number;
	baseRangeMeters: number;
	dropMeters: number | null;
	framingX: number;
	framingY: number;
	source: 'terrain' | 'fallback' | 'curated';
}

export interface CesiumCameraOffset {
	headingRadians: number;
	pitchRadians: number;
	rollRadians: number;
	rangeMeters: number;
	framingX: number;
	framingY: number;
}

export interface TerrainCameraSession {
	resolve(query: TerrainCameraQuery): Promise<TerrainCameraPose>;
}

const RING_BEARINGS_DEGREES = [0, 45, 90, 135, 180, 225, 270, 315] as const;
const NEAR_RING_METERS = 2_000;
const FAR_RING_METERS = 12_000;
const SAMPLE_COUNT = 1 + RING_BEARINGS_DEGREES.length * 2;

export const TERRAIN_SAMPLE_LEVEL = 11;

const RELIEF_DROP_FLOOR_METERS = 700;
const RELIEF_DROP_SPAN_METERS = 900;
const FAR_BASE_RANGE_METERS = 14_000;
const NEAR_BASE_RANGE_METERS = 8_000;
const RANGE_RELIEF_SPAN_METERS = FAR_BASE_RANGE_METERS - NEAR_BASE_RANGE_METERS;

const CAMERA_PITCH_DEGREES = -22;
const CAMERA_ROLL_DEGREES = 0;

const ASPECT_NUMERATOR = 1.35;
const ASPECT_SCALE_MIN = 0.85;
const ASPECT_SCALE_MAX = 1.25;

const FALLBACK_BASE_RANGE_METERS = 11_000;
const FALLBACK_HEADING_DEGREES = 0;

const WGS84_A = 6_378_137;
const WGS84_F = 1 / 298.257223563;
const WGS84_B = WGS84_A * (1 - WGS84_F);

interface CachedFraming {
	baseRangeMeters: number;
	headingDegrees: number;
	pitchDegrees: number;
	dropMeters: number | null;
	framingX: number;
	framingY: number;
	source: 'terrain' | 'curated';
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function wrapLongitude(degrees: number): number {
	return ((((degrees + 180) % 360) + 360) % 360) - 180;
}

function geodesicDestination(
	latitude: number,
	longitude: number,
	bearingDegrees: number,
	distanceMeters: number
): GeographicPosition {
	const φ1 = (latitude * Math.PI) / 180;
	const α1 = (bearingDegrees * Math.PI) / 180;
	const sinα1 = Math.sin(α1);
	const cosα1 = Math.cos(α1);
	const tanU1 = (1 - WGS84_F) * Math.tan(φ1);
	const cosU1 = 1 / Math.sqrt(1 + tanU1 * tanU1);
	const sinU1 = tanU1 * cosU1;
	const σ1 = Math.atan2(tanU1, cosα1);
	const sinα = cosU1 * sinα1;
	const cosSqα = 1 - sinα * sinα;
	const uSq = (cosSqα * (WGS84_A * WGS84_A - WGS84_B * WGS84_B)) / (WGS84_B * WGS84_B);
	const A = 1 + (uSq / 16384) * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)));
	const B = (uSq / 1024) * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)));

	let σ = distanceMeters / (WGS84_B * A);
	let previous = Number.POSITIVE_INFINITY;
	let cos2σm = 0;
	let sinσ = 0;
	let cosσ = 0;

	for (let iteration = 0; iteration < 100 && Math.abs(σ - previous) > 1e-12; iteration += 1) {
		cos2σm = Math.cos(2 * σ1 + σ);
		sinσ = Math.sin(σ);
		cosσ = Math.cos(σ);
		const Δσ =
			B *
			sinσ *
			(cos2σm +
				(B / 4) *
					(cosσ * (-1 + 2 * cos2σm * cos2σm) -
						(B / 6) * cos2σm * (-3 + 4 * sinσ * sinσ) * (-3 + 4 * cos2σm * cos2σm)));
		previous = σ;
		σ = distanceMeters / (WGS84_B * A) + Δσ;
	}

	const latitudeFactor = sinU1 * sinσ - cosU1 * cosσ * cosα1;
	const φ2 = Math.atan2(
		sinU1 * cosσ + cosU1 * sinσ * cosα1,
		(1 - WGS84_F) * Math.sqrt(sinα * sinα + latitudeFactor * latitudeFactor)
	);
	const λ = Math.atan2(sinσ * sinα1, cosU1 * cosσ - sinU1 * sinσ * cosα1);
	const C = (WGS84_F / 16) * cosSqα * (4 + WGS84_F * (4 - 3 * cosSqα));
	const L =
		λ -
		(1 - C) * WGS84_F * sinα * (σ + C * sinσ * (cos2σm + C * cosσ * (-1 + 2 * cos2σm * cos2σm)));

	return {
		latitude: (φ2 * 180) / Math.PI,
		longitude: wrapLongitude(longitude + (L * 180) / Math.PI)
	};
}

function terrainSamplePositions(latitude: number, longitude: number): GeographicPosition[] {
	const positions: GeographicPosition[] = [{ latitude, longitude }];
	for (const distanceMeters of [NEAR_RING_METERS, FAR_RING_METERS]) {
		for (const bearingDegrees of RING_BEARINGS_DEGREES) {
			positions.push(geodesicDestination(latitude, longitude, bearingDegrees, distanceMeters));
		}
	}
	return positions;
}

function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const mid = sorted.length / 2;
	return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function headingFromRings(near: readonly number[], far: readonly number[]): number {
	let best = 0;
	for (let index = 1; index < RING_BEARINGS_DEGREES.length; index += 1) {
		const lowerFarTerrain = far[index]! < far[best]!;
		const lowerNearTerrainOnTie = far[index] === far[best] && near[index]! < near[best]!;
		if (lowerFarTerrain || lowerNearTerrainOnTie) {
			best = index;
		}
	}
	return RING_BEARINGS_DEGREES[best]!;
}

function baseRangeFromDrop(dropMeters: number): number {
	const t = clamp((dropMeters - RELIEF_DROP_FLOOR_METERS) / RELIEF_DROP_SPAN_METERS, 0, 1);
	return FAR_BASE_RANGE_METERS - t * RANGE_RELIEF_SPAN_METERS;
}

export function stageAspectScale(stageWidth: number, stageHeight: number): number {
	return clamp(ASPECT_NUMERATOR / (stageWidth / stageHeight), ASPECT_SCALE_MIN, ASPECT_SCALE_MAX);
}

function finiteSample(values: readonly (number | undefined)[]): number[] | null {
	if (values.length !== SAMPLE_COUNT) {
		return null;
	}
	const heights: number[] = [];
	for (const value of values) {
		if (typeof value !== 'number' || !Number.isFinite(value)) {
			return null;
		}
		heights.push(value);
	}
	return heights;
}

function framingFromHeights(heights: readonly number[]): CachedFraming {
	const near = heights.slice(1, 9);
	const far = heights.slice(9, 17);
	const dropMeters = heights[0]! - median(near);
	return {
		dropMeters,
		baseRangeMeters: baseRangeFromDrop(dropMeters),
		headingDegrees: headingFromRings(near, far),
		pitchDegrees: CAMERA_PITCH_DEGREES,
		framingX: 0,
		framingY: 0,
		source: 'terrain'
	};
}

async function sampleFraming(query: TerrainCameraQuery): Promise<CachedFraming | null> {
	if (!query.terrain) {
		return null;
	}
	try {
		const sampled = await query.terrain.sampleHeights(
			terrainSamplePositions(query.latitude, query.longitude)
		);
		const heights = finiteSample(sampled);
		return heights ? framingFromHeights(heights) : null;
	} catch {
		return null;
	}
}

export function poseForStage(
	pose: TerrainCameraPose,
	stageWidth: number,
	stageHeight: number
): TerrainCameraPose {
	return {
		...pose,
		rangeMeters: pose.baseRangeMeters * stageAspectScale(stageWidth, stageHeight)
	};
}

function poseFrom(
	framing: CachedFraming | null,
	stageWidth: number,
	stageHeight: number
): TerrainCameraPose {
	const scale = stageAspectScale(stageWidth, stageHeight);
	if (!framing) {
		return {
			headingDegrees: FALLBACK_HEADING_DEGREES,
			pitchDegrees: CAMERA_PITCH_DEGREES,
			rollDegrees: CAMERA_ROLL_DEGREES,
			baseRangeMeters: FALLBACK_BASE_RANGE_METERS,
			rangeMeters: FALLBACK_BASE_RANGE_METERS * scale,
			dropMeters: null,
			framingX: 0,
			framingY: 0,
			source: 'fallback'
		};
	}
	return {
		headingDegrees: framing.headingDegrees,
		pitchDegrees: framing.pitchDegrees,
		rollDegrees: CAMERA_ROLL_DEGREES,
		baseRangeMeters: framing.baseRangeMeters,
		rangeMeters: framing.baseRangeMeters * scale,
		dropMeters: framing.dropMeters,
		framingX: framing.framingX,
		framingY: framing.framingY,
		source: framing.source
	};
}

function curatedFraming(camera: EditorialCamera): CachedFraming {
	const framing = resolvedFraming(camera.framing);
	return {
		baseRangeMeters: camera.rangeMeters,
		headingDegrees: camera.headingDegrees,
		pitchDegrees: camera.pitchDegrees,
		dropMeters: null,
		framingX: framing.x,
		framingY: framing.y,
		source: 'curated'
	};
}

export function editorialPoseFromOffset(
	eastMeters: number,
	northMeters: number,
	upMeters: number,
	stageWidth: number,
	stageHeight: number
): EditorialCamera {
	const horizontal = Math.hypot(eastMeters, northMeters);
	const observedRange = Math.hypot(horizontal, upMeters);
	const scale = stageAspectScale(stageWidth, stageHeight);
	const bearing = viewpointBearingDegrees(eastMeters, northMeters);
	const standpoint = Number.isFinite(bearing) ? bearing : 0;
	return {
		headingDegrees: (standpoint + 180) % 360,
		pitchDegrees: (Math.atan2(-upMeters, horizontal) * 180) / Math.PI,
		rangeMeters: scale === 0 ? observedRange : observedRange / scale
	};
}

export interface SummitCameraReading {
	headingDegrees: number;
	pitchDegrees: number;
	displayRangeMeters: number;
	baseRangeMeters: number;
	stageAspect: number;
	aspectScale: number;
}

export function readSummitCamera(
	eastMeters: number,
	northMeters: number,
	upMeters: number,
	stageWidth: number,
	stageHeight: number
): SummitCameraReading {
	const editorial = editorialPoseFromOffset(
		eastMeters,
		northMeters,
		upMeters,
		stageWidth,
		stageHeight
	);
	return {
		headingDegrees: editorial.headingDegrees,
		pitchDegrees: editorial.pitchDegrees,
		displayRangeMeters: Math.hypot(eastMeters, northMeters, upMeters),
		baseRangeMeters: editorial.rangeMeters,
		stageAspect: stageWidth > 0 && stageHeight > 0 ? stageWidth / stageHeight : 0,
		aspectScale: stageAspectScale(stageWidth, stageHeight)
	};
}

export function previewOffset(
	pose: EditorialCamera,
	stageWidth: number,
	stageHeight: number
): CesiumCameraOffset {
	return cesiumCameraOffset(
		poseForStage(
			{
				headingDegrees: pose.headingDegrees,
				pitchDegrees: pose.pitchDegrees,
				rollDegrees: CAMERA_ROLL_DEGREES,
				rangeMeters: pose.rangeMeters,
				baseRangeMeters: pose.rangeMeters,
				dropMeters: null,
				framingX: resolvedFraming(pose.framing).x,
				framingY: resolvedFraming(pose.framing).y,
				source: 'curated'
			},
			stageWidth,
			stageHeight
		)
	);
}

export function createTerrainCameraSession(): TerrainCameraSession {
	const cache = new Map<string, CachedFraming>();

	return {
		async resolve(query) {
			if (query.camera) {
				const framing = curatedFraming(query.camera);
				cache.set(query.slug, framing);
				return poseFrom(framing, query.stageWidth, query.stageHeight);
			}
			const cached = cache.get(query.slug);
			if (cached?.source === 'terrain') {
				return poseFrom(cached, query.stageWidth, query.stageHeight);
			}
			const framing = await sampleFraming(query);
			if (framing) {
				cache.set(query.slug, framing);
			}
			return poseFrom(framing, query.stageWidth, query.stageHeight);
		}
	};
}

export function cameraStandpointDegrees(headingDegrees: number): number {
	return (headingDegrees + 180) % 360;
}

export function cesiumCameraOffset(pose: TerrainCameraPose): CesiumCameraOffset {
	const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
	return {
		headingRadians: toRadians(pose.headingDegrees),
		pitchRadians: toRadians(pose.pitchDegrees),
		rollRadians: toRadians(pose.rollDegrees),
		rangeMeters: pose.rangeMeters,
		framingX: pose.framingX,
		framingY: pose.framingY
	};
}
