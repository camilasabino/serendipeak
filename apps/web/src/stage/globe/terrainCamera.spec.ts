import { describe, expect, it } from 'vitest';
import {
	cameraStandpointDegrees,
	cesiumCameraOffset,
	createTerrainCameraSession,
	editorialPoseFromOffset,
	poseForStage,
	previewOffset,
	STAGE_FILL_MIN_ASPECT,
	STAGE_REFERENCE_ASPECT,
	stageAspectScale,
	type GeographicPosition,
	type TerrainCameraQuery,
	type TerrainHeightSource
} from './terrainCamera';

const BEARINGS = [0, 45, 90, 135, 180, 225, 270, 315];
const NEUTRAL_STAGE = { stageWidth: 1350, stageHeight: 1000 };
const NARROW_STAGE = { stageWidth: 560, stageHeight: 762 };
const WIDE_STAGE = { stageWidth: 895, stageHeight: 468 };
const INTERMEDIATE_STAGE = { stageWidth: 1200, stageHeight: 800 };

function ring(height: number): number[] {
	return BEARINGS.map(() => height);
}

function heights(summit: number, near: number[], far: number[]): number[] {
	return [summit, ...near, ...far];
}

function query(
	overrides: Partial<TerrainCameraQuery> & Pick<TerrainCameraQuery, 'terrain'>
): TerrainCameraQuery {
	return {
		slug: 'peak',
		latitude: 27.99,
		longitude: 86.93,
		elevationMeters: 8849,
		...NEUTRAL_STAGE,
		...overrides
	};
}

function recordingTerrain(
	respond: (
		positions: readonly GeographicPosition[]
	) => readonly (number | undefined)[] | Promise<readonly (number | undefined)[]>
) {
	const calls: GeographicPosition[][] = [];
	const terrain: TerrainHeightSource = {
		async sampleHeights(positions) {
			const recorded = positions.map((position) => ({ ...position }));
			calls.push(recorded);
			return respond(recorded);
		}
	};
	return { calls, terrain };
}

function distanceMeters(origin: GeographicPosition, point: GeographicPosition): number {
	const radius = 6_371_008.8;
	const lat1 = (origin.latitude * Math.PI) / 180;
	const lat2 = (point.latitude * Math.PI) / 180;
	const dLat = lat2 - lat1;
	let dLon = ((point.longitude - origin.longitude) * Math.PI) / 180;
	dLon = Math.atan2(Math.sin(dLon), Math.cos(dLon));
	const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
	return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)));
}

function bearingDegrees(origin: GeographicPosition, point: GeographicPosition): number {
	const lat1 = (origin.latitude * Math.PI) / 180;
	const lat2 = (point.latitude * Math.PI) / 180;
	let dLon = ((point.longitude - origin.longitude) * Math.PI) / 180;
	dLon = Math.atan2(Math.sin(dLon), Math.cos(dLon));
	const y = Math.sin(dLon) * Math.cos(lat2);
	const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
	return (Math.atan2(y, x) * 180) / Math.PI;
}

function angularError(actual: number, expected: number): number {
	const delta = Math.abs(actual - expected) % 360;
	return Math.min(delta, 360 - delta);
}

const PYRAMID = heights(5000, ring(3000), [2000, 2000, 100, 2000, 2000, 2000, 2000, 2000]);
const PLATEAU = heights(2500, ring(2200), [900, 900, 900, 900, 100, 900, 900, 900]);
const MASSIF = heights(4000, ring(2875), [700, 700, 700, 700, 700, 700, 700, 50]);

describe('terrain sample positions', () => {
	it('asks for the summit and both eight-point rings in bearing order', async () => {
		const { calls, terrain } = recordingTerrain(() => PYRAMID);
		await createTerrainCameraSession().resolve(query({ terrain }));

		expect(calls).toHaveLength(1);
		const [positions] = calls;
		expect(positions).toHaveLength(17);
		expect(positions![0]).toEqual({ latitude: 27.99, longitude: 86.93 });

		const origin = positions![0];
		for (const [index, bearing] of BEARINGS.entries()) {
			const near = positions![1 + index];
			const far = positions![9 + index];
			expect(distanceMeters(origin!, near!)).toBeGreaterThan(1_950);
			expect(distanceMeters(origin!, near!)).toBeLessThan(2_050);
			expect(distanceMeters(origin!, far!)).toBeGreaterThan(11_900);
			expect(distanceMeters(origin!, far!)).toBeLessThan(12_100);
			expect(angularError(bearingDegrees(origin!, near!), bearing)).toBeLessThan(0.2);
			expect(angularError(bearingDegrees(origin!, far!), bearing)).toBeLessThan(0.2);
		}
	});

	it('repeats the same positions for the same summit', async () => {
		const first = recordingTerrain(() => PYRAMID);
		const second = recordingTerrain(() => PYRAMID);
		await createTerrainCameraSession().resolve(query({ slug: 'a', terrain: first.terrain }));
		await createTerrainCameraSession().resolve(query({ slug: 'b', terrain: second.terrain }));

		expect(second.calls[0]).toEqual(first.calls[0]);
	});

	it('wraps a 12 km east position across longitude 180', async () => {
		const { calls, terrain } = recordingTerrain(() => PYRAMID);
		await createTerrainCameraSession().resolve(query({ latitude: 0, longitude: 179.95, terrain }));

		const east = calls[0]![9 + BEARINGS.indexOf(90)];
		expect(east!.longitude).toBeGreaterThan(-180);
		expect(east!.longitude).toBeLessThan(-179);
		expect(east!.latitude).toBeCloseTo(0, 3);
		for (const position of calls[0]!) {
			expect(position.longitude).toBeGreaterThanOrEqual(-180);
			expect(position.longitude).toBeLessThanOrEqual(180);
		}
	});

	it('moves farther in longitude at high latitude than a degree-per-metre offset would', async () => {
		const { calls, terrain } = recordingTerrain(() => PYRAMID);
		await createTerrainCameraSession().resolve(query({ latitude: 80, longitude: 20, terrain }));

		const origin = calls[0]![0];
		const north = calls[0]![1 + BEARINGS.indexOf(0)];
		const east = calls[0]![9 + BEARINGS.indexOf(90)];
		expect(north!.latitude).toBeGreaterThan(80);
		expect(Math.abs(north!.longitude - origin!.longitude)).toBeLessThan(0.02);
		const eastShift = east!.longitude - origin!.longitude;
		expect(eastShift).toBeGreaterThan(0.45);
		expect(eastShift).toBeLessThan(0.9);
		expect(distanceMeters(origin!, east!)).toBeGreaterThan(11_900);
		expect(distanceMeters(origin!, east!)).toBeLessThan(12_100);
	});
});

describe('local relief range', () => {
	it('uses 14 km when the 2 km drop is at or below 700 m', async () => {
		for (const drop of [0, 699, 700]) {
			const { terrain } = recordingTerrain(() => heights(1_000, ring(1_000 - drop), ring(0)));
			const pose = await createTerrainCameraSession().resolve(
				query({ slug: `low-${drop}`, terrain })
			);
			expect(pose.baseRangeMeters).toBe(14_000);
			expect(pose.dropMeters).toBe(drop);
		}
	});

	it('uses 8 km when the 2 km drop is at or above 1,600 m', async () => {
		for (const drop of [1_600, 1_601, 5_000]) {
			const { terrain } = recordingTerrain(() => heights(6_000, ring(6_000 - drop), ring(0)));
			const pose = await createTerrainCameraSession().resolve(
				query({ slug: `high-${drop}`, terrain })
			);
			expect(pose.baseRangeMeters).toBe(8_000);
		}
	});

	it('interpolates a drop inside the 700 m to 1,600 m span', async () => {
		const { terrain } = recordingTerrain(() => heights(2_000, ring(850), ring(0)));
		const pose = await createTerrainCameraSession().resolve(query({ terrain }));

		expect(pose.dropMeters).toBe(1_150);
		expect(pose.baseRangeMeters).toBe(11_000);
	});

	it('averages the 4th and 5th sorted 2 km heights', async () => {
		const near = [10, 30, 20, 40, 80, 60, 50, 70];
		const { terrain } = recordingTerrain(() => heights(1_045, near, ring(0)));
		const pose = await createTerrainCameraSession().resolve(query({ terrain }));

		expect(pose.dropMeters).toBe(1_000);
		expect(pose.baseRangeMeters).toBe(12_000);
	});

	it('keeps the same range when only the catalog elevation changes', async () => {
		const low = recordingTerrain(() => MASSIF);
		const high = recordingTerrain(() => MASSIF);
		const lowPose = await createTerrainCameraSession().resolve(
			query({ slug: 'low-summit', elevationMeters: 100, terrain: low.terrain })
		);
		const highPose = await createTerrainCameraSession().resolve(
			query({ slug: 'high-summit', elevationMeters: 8_849, terrain: high.terrain })
		);

		expect(lowPose.baseRangeMeters).toBeCloseTo(11_166.6666667, 5);
		expect(highPose.baseRangeMeters).toBe(lowPose.baseRangeMeters);
		expect(highPose.headingDegrees).toBe(lowPose.headingDegrees);
		expect(high.calls[0]).toEqual(low.calls[0]);
	});

	it('frames a steep pyramid near 8 km, a plateau near 14 km, and a massif between them', async () => {
		const pyramid = await createTerrainCameraSession().resolve(
			query({
				slug: 'pyramid',
				terrain: recordingTerrain(() => PYRAMID).terrain
			})
		);
		const plateau = await createTerrainCameraSession().resolve(
			query({
				slug: 'plateau',
				terrain: recordingTerrain(() => PLATEAU).terrain
			})
		);
		const massif = await createTerrainCameraSession().resolve(
			query({
				slug: 'massif',
				terrain: recordingTerrain(() => MASSIF).terrain
			})
		);

		expect(pyramid.baseRangeMeters).toBe(8_000);
		expect(pyramid.headingDegrees).toBe(90);
		expect(plateau.baseRangeMeters).toBe(14_000);
		expect(plateau.headingDegrees).toBe(180);
		expect(massif.baseRangeMeters).toBeCloseTo(11_166.6666667, 5);
		expect(massif.headingDegrees).toBe(315);
		expect(pyramid.source).toBe('terrain');
	});
});

describe('lowest far-terrain heading', () => {
	it('selects the bearing of the lowest 12 km sample', async () => {
		const far = ring(500);
		far[BEARINGS.indexOf(270)] = 10;
		const { terrain } = recordingTerrain(() => heights(4_000, ring(3_000), far));
		const pose = await createTerrainCameraSession().resolve(query({ terrain }));

		expect(pose.headingDegrees).toBe(270);
	});

	it('breaks a 12 km tie with the lower 2 km sample', async () => {
		const near = ring(1_000);
		const far = ring(500);
		near[BEARINGS.indexOf(90)] = 800;
		near[BEARINGS.indexOf(180)] = 100;
		far[BEARINGS.indexOf(90)] = 20;
		far[BEARINGS.indexOf(180)] = 20;
		const { terrain } = recordingTerrain(() => heights(2_000, near, far));
		const pose = await createTerrainCameraSession().resolve(query({ terrain }));

		expect(pose.headingDegrees).toBe(180);
	});

	it('breaks a remaining tie toward the smaller bearing', async () => {
		const near = ring(1_000);
		const far = ring(500);
		for (const bearing of [90, 270]) {
			near[BEARINGS.indexOf(bearing)] = 100;
			far[BEARINGS.indexOf(bearing)] = 20;
		}
		const { terrain } = recordingTerrain(() => heights(2_000, near, far));
		const pose = await createTerrainCameraSession().resolve(query({ terrain }));

		expect(pose.headingDegrees).toBe(90);
	});

	it('looks along the low far bearing instead of standing on it', async () => {
		const near = ring(2_000);
		const far = ring(1_000);
		near[BEARINGS.indexOf(225)] = 100;
		far[BEARINGS.indexOf(45)] = 10;
		const { terrain } = recordingTerrain(() => heights(4_000, near, far));
		const pose = await createTerrainCameraSession().resolve(query({ terrain }));
		const offset = cesiumCameraOffset(pose);

		expect(pose.headingDegrees).toBe(45);
		expect(pose.headingDegrees).not.toBe(225);
		expect(cameraStandpointDegrees(pose.headingDegrees)).toBe(225);
		expect(offset.headingRadians).toBeCloseTo((45 * Math.PI) / 180, 10);
		expect(offset.headingRadians).not.toBeCloseTo((225 * Math.PI) / 180, 10);
	});

	it('leaves a due-north look when that far sample is the highest ridge', async () => {
		const far = ring(100);
		far[BEARINGS.indexOf(0)] = 5_000;
		far[BEARINGS.indexOf(90)] = 10;
		const { terrain } = recordingTerrain(() => heights(4_000, ring(2_000), far));
		const pose = await createTerrainCameraSession().resolve(query({ terrain }));

		expect(pose.headingDegrees).toBe(90);
		expect(cameraStandpointDegrees(pose.headingDegrees)).toBe(270);
	});
});

describe('aspect scaling', () => {
	it('clamps a narrow stage to 1.25 and a wide stage to 0.85', async () => {
		const narrow = await createTerrainCameraSession().resolve(
			query({
				slug: 'narrow',
				...NARROW_STAGE,
				terrain: recordingTerrain(() => PYRAMID).terrain
			})
		);
		const wide = await createTerrainCameraSession().resolve(
			query({
				slug: 'wide',
				...WIDE_STAGE,
				terrain: recordingTerrain(() => PYRAMID).terrain
			})
		);

		expect(narrow.baseRangeMeters).toBe(8_000);
		expect(narrow.rangeMeters).toBe(10_000);
		expect(wide.baseRangeMeters).toBe(8_000);
		expect(wide.rangeMeters).toBe(6_800);
	});

	it('keeps an intermediate aspect inside the clamp', async () => {
		const pose = await createTerrainCameraSession().resolve(
			query({
				...INTERMEDIATE_STAGE,
				terrain: recordingTerrain(() => PYRAMID).terrain
			})
		);

		expect(pose.baseRangeMeters).toBe(8_000);
		expect(pose.rangeMeters).toBe(7_200);
	});

	it('reuses one terrain result and changes only the final range', async () => {
		const { calls, terrain } = recordingTerrain(() => PYRAMID);
		const session = createTerrainCameraSession();
		const narrow = await session.resolve(query({ ...NARROW_STAGE, terrain }));
		const wide = await session.resolve(query({ ...WIDE_STAGE, terrain }));

		expect(calls).toHaveLength(1);
		expect(narrow.baseRangeMeters).toBe(8_000);
		expect(wide.baseRangeMeters).toBe(narrow.baseRangeMeters);
		expect(wide.headingDegrees).toBe(narrow.headingDegrees);
		expect(wide.dropMeters).toBe(narrow.dropMeters);
		expect(narrow.rangeMeters).toBe(10_000);
		expect(wide.rangeMeters).toBe(6_800);
		expect(narrow.pitchDegrees).toBe(wide.pitchDegrees);
	});
});

describe('terrain fallback and session cache', () => {
	it('uses the fixed pose when no terrain provider is available', async () => {
		const pose = await createTerrainCameraSession().resolve(
			query({ ...NARROW_STAGE, terrain: null })
		);

		expect(pose.source).toBe('fallback');
		expect(pose.dropMeters).toBeNull();
		expect(pose.baseRangeMeters).toBe(11_000);
		expect(pose.rangeMeters).toBe(13_750);
		expect(pose.headingDegrees).toBe(0);
		expect(pose.pitchDegrees).toBe(-22);
		expect(pose.rollDegrees).toBe(0);
	});

	it('uses the fixed pose when sampling rejects', async () => {
		const { calls, terrain } = recordingTerrain(() => Promise.reject(new Error('tile')));
		const pose = await createTerrainCameraSession().resolve(query({ terrain }));

		expect(calls).toHaveLength(1);
		expect(pose.source).toBe('fallback');
		expect(pose.baseRangeMeters).toBe(11_000);
		expect(pose.rangeMeters).toBe(11_000);
		expect(pose.headingDegrees).toBe(0);
		expect(pose.pitchDegrees).toBe(-22);
	});

	it.each([
		{ name: 'a short height list', respond: () => PYRAMID.slice(0, 16) },
		{
			name: 'a missing height',
			respond: () => PYRAMID.map((height, index) => (index === 4 ? undefined : height))
		},
		{
			name: 'a non-finite height',
			respond: () => PYRAMID.map((height, index) => (index === 0 ? Number.NaN : height))
		},
		{
			name: 'an infinite height',
			respond: () =>
				PYRAMID.map((height, index) => (index === 12 ? Number.POSITIVE_INFINITY : height))
		}
	])('uses the fixed pose for $name', async ({ respond }) => {
		const { terrain } = recordingTerrain(respond);
		const pose = await createTerrainCameraSession().resolve(
			query({ elevationMeters: 8_849, terrain })
		);

		expect(pose.source).toBe('fallback');
		expect(pose.baseRangeMeters).toBe(11_000);
		expect(pose.headingDegrees).toBe(0);
		expect(pose.dropMeters).toBeNull();
	});

	it('does not keep a failed sample, and does keep the next successful one', async () => {
		let attempt = 0;
		const { calls, terrain } = recordingTerrain(() => {
			attempt += 1;
			if (attempt === 1) {
				return Promise.reject(new Error('tile'));
			}
			return PYRAMID;
		});
		const session = createTerrainCameraSession();

		const failed = await session.resolve(query({ ...NARROW_STAGE, terrain }));
		const recovered = await session.resolve(query({ ...WIDE_STAGE, terrain }));
		const cached = await session.resolve(query({ ...NARROW_STAGE, terrain }));

		expect(failed.source).toBe('fallback');
		expect(recovered.source).toBe('terrain');
		expect(recovered.baseRangeMeters).toBe(8_000);
		expect(recovered.rangeMeters).toBe(6_800);
		expect(cached.rangeMeters).toBe(10_000);
		expect(cached.baseRangeMeters).toBe(recovered.baseRangeMeters);
		expect(calls).toHaveLength(2);
	});
});

describe('curated camera precedence', () => {
	const curated = { headingDegrees: 140, pitchDegrees: -16, rangeMeters: 9_000 };

	it('uses the curated base pose and does not sample terrain', async () => {
		const calls: number[] = [];
		const session = createTerrainCameraSession();
		const terrain = {
			async sampleHeights() {
				calls.push(1);
				return Array.from({ length: 17 }, () => 1_000);
			}
		};

		const narrow = await session.resolve(query({ camera: curated, terrain, ...NARROW_STAGE }));
		const wide = await session.resolve(query({ camera: curated, terrain, ...WIDE_STAGE }));

		expect(calls).toHaveLength(0);
		expect(narrow.source).toBe('curated');
		expect(narrow.headingDegrees).toBe(140);
		expect(narrow.pitchDegrees).toBe(-16);
		expect(narrow.baseRangeMeters).toBe(9_000);
		expect(narrow.rangeMeters).toBe(9_000 * 1.25);
		expect(wide.headingDegrees).toBe(140);
		expect(wide.pitchDegrees).toBe(-16);
		expect(wide.rangeMeters).toBe(9_000 * 0.85);
		expect(wide.dropMeters).toBeNull();
		expect(narrow.framingX).toBe(0);
		expect(narrow.framingY).toBe(0);
		expect(wide.framingX).toBe(0);
		expect(wide.framingY).toBe(0);
	});

	it('passes an owner-curated positive pitch through unchanged without sampling', async () => {
		const calls: number[] = [];
		const session = createTerrainCameraSession();
		const terrain = {
			async sampleHeights() {
				calls.push(1);
				return Array.from({ length: 17 }, () => 1_000);
			}
		};
		const upward = {
			headingDegrees: 95.41,
			pitchDegrees: 6.64,
			rangeMeters: 9_519,
			framing: { x: -0.0214, y: 0.3924 }
		};

		const pose = await session.resolve(query({ camera: upward, terrain, ...WIDE_STAGE }));

		expect(calls).toHaveLength(0);
		expect(pose.source).toBe('curated');
		expect(pose.headingDegrees).toBe(95.41);
		expect(pose.pitchDegrees).toBe(6.64);
		expect(pose.baseRangeMeters).toBe(9_519);
		expect(pose.framingX).toBe(-0.0214);
		expect(pose.framingY).toBe(0.3924);
	});

	it('keeps a stored framing and treats a missing framing as centered', async () => {
		const session = createTerrainCameraSession();
		const framed = await session.resolve(
			query({
				camera: { ...curated, framing: { x: -0.2, y: 0.15 } },
				terrain: null,
				...NARROW_STAGE
			})
		);
		const centered = await session.resolve(
			query({ slug: 'centered', camera: curated, terrain: null, ...WIDE_STAGE })
		);

		expect(framed.source).toBe('curated');
		expect(framed.framingX).toBe(-0.2);
		expect(framed.framingY).toBe(0.15);
		expect(framed.baseRangeMeters).toBe(9_000);
		expect(framed.rangeMeters).toBe(9_000 * 1.25);
		expect(centered.framingX).toBe(0);
		expect(centered.framingY).toBe(0);
		expect(centered.rangeMeters).toBe(9_000 * 0.85);
		expect(poseForStage(framed, WIDE_STAGE.stageWidth, WIDE_STAGE.stageHeight)).toMatchObject({
			headingDegrees: 140,
			baseRangeMeters: 9_000,
			framingX: -0.2,
			framingY: 0.15,
			rangeMeters: 9_000 * 0.85
		});
	});

	it('samples the automatic pose when a later resolve omits the curated camera', async () => {
		const calls: number[] = [];
		const session = createTerrainCameraSession();
		const terrain = {
			async sampleHeights() {
				calls.push(1);
				return Array.from({ length: 17 }, () => 1_000);
			}
		};

		const curatedPose = await session.resolve(query({ camera: curated, terrain, ...NARROW_STAGE }));
		const automaticPose = await session.resolve(query({ terrain, ...NARROW_STAGE }));

		expect(curatedPose.source).toBe('curated');
		expect(curatedPose.headingDegrees).toBe(140);
		expect(calls).toHaveLength(1);
		expect(automaticPose.source).toBe('terrain');
		expect(automaticPose.headingDegrees).not.toBe(140);
	});

	it('still samples a mountain that has no curated pose', async () => {
		const calls: number[] = [];
		const session = createTerrainCameraSession();
		const pose = await session.resolve(
			query({
				terrain: {
					async sampleHeights() {
						calls.push(1);
						return Array.from({ length: 17 }, () => 1_000);
					}
				}
			})
		);

		expect(calls).toHaveLength(1);
		expect(pose.source).toBe('terrain');
		expect(pose.pitchDegrees).toBe(-22);
	});

	it('keeps the deterministic fallback when sampling fails and no pose is curated', async () => {
		const session = createTerrainCameraSession();
		const pose = await session.resolve(
			query({
				terrain: {
					async sampleHeights() {
						throw new Error('tile');
					}
				}
			})
		);

		expect(pose).toMatchObject({
			source: 'fallback',
			headingDegrees: 0,
			pitchDegrees: -22,
			baseRangeMeters: 11_000,
			rangeMeters: 11_000,
			framingX: 0,
			framingY: 0
		});
	});
});

describe('editorial pose from a summit offset', () => {
	it('reads heading as the look direction and pitch from the camera height', () => {
		const north = editorialPoseFromOffset(0, 10_000, 0, 1350, 1000);
		expect(north.headingDegrees).toBe(180);
		expect(north.pitchDegrees).toBeCloseTo(0);
		expect(editorialPoseFromOffset(0, -10_000, 0, 1350, 1000).headingDegrees).toBeCloseTo(0);
		expect(editorialPoseFromOffset(0, 0, 10_000, 1350, 1000).pitchDegrees).toBeCloseTo(-90);
	});

	it('stores the viewport-independent base range', () => {
		const pose = editorialPoseFromOffset(0, 8_500, 0, 895, 468);
		expect(pose.rangeMeters).toBeCloseTo(10_000);
	});
});

describe('poseForStage', () => {
	const pose = {
		headingDegrees: 90,
		pitchDegrees: -22,
		rollDegrees: 0,
		rangeMeters: 1,
		baseRangeMeters: 10_000,
		dropMeters: 1_200,
		framingX: 0,
		framingY: 0,
		source: 'terrain' as const
	};

	it('recomputes range from the base pose and leaves heading alone', () => {
		const narrow = poseForStage(pose, 560, 762);
		const wide = poseForStage(pose, 895, 468);

		expect(narrow.rangeMeters).toBe(12_500);
		expect(wide.rangeMeters).toBe(8_500);
		expect(narrow.headingDegrees).toBe(90);
		expect(wide.baseRangeMeters).toBe(10_000);
		expect(wide.source).toBe('terrain');
	});

	it('keeps a fallback pose on the same scale', () => {
		const fallback = poseForStage(
			{ ...pose, headingDegrees: 0, baseRangeMeters: 11_000, dropMeters: null, source: 'fallback' },
			1350,
			1000
		);

		expect(fallback.rangeMeters).toBe(11_000);
		expect(fallback.headingDegrees).toBe(0);
		expect(fallback.source).toBe('fallback');
	});
});

describe('editor reference stage', () => {
	const saved = { headingDegrees: 66.87, pitchDegrees: -19.85, rangeMeters: 17_132 };
	const REFERENCE_WIDTH = 1_600;
	const REFERENCE_HEIGHT = REFERENCE_WIDTH / STAGE_REFERENCE_ASPECT;

	it('frames the stage where the range scale is clamped, so sub-pixel aspect jitter is inert', () => {
		const scale = stageAspectScale(REFERENCE_WIDTH, REFERENCE_HEIGHT);

		expect(scale).toBe(0.85);
		expect(stageAspectScale(REFERENCE_WIDTH + 1, REFERENCE_HEIGHT)).toBe(scale);
		expect(stageAspectScale(REFERENCE_WIDTH - 1, REFERENCE_HEIGHT)).toBe(scale);
	});

	it('lets a stage fill down to the narrowest aspect that keeps the reference range', () => {
		expect(stageAspectScale(REFERENCE_WIDTH, REFERENCE_WIDTH / STAGE_FILL_MIN_ASPECT)).toBeCloseTo(
			0.85,
			10
		);
		expect(stageAspectScale(1_000, 1_000 / (STAGE_FILL_MIN_ASPECT - 0.05))).toBeGreaterThan(0.85);
	});

	it.each([
		['full HD window', 1_472, 836],
		['2560 x 1440 window', 2_112, 1_186],
		['ultrawide window', 2_992, 1_186]
	])('previews the range a visitor on a %s is shown', (_name, width, height) => {
		const preview = previewOffset(saved, REFERENCE_WIDTH, REFERENCE_HEIGHT);
		const visitor = previewOffset(saved, width, height);

		expect(preview.rangeMeters).toBeCloseTo(visitor.rangeMeters, 6);
		expect(preview.headingRadians).toBe(visitor.headingRadians);
		expect(preview.pitchRadians).toBe(visitor.pitchRadians);
	});

	// The editor fills its workspace down to the narrowest aspect that keeps the reference range and
	// letterboxes anything narrower at that aspect (CameraEditor.module.css).
	it.each([
		['laptop', 1_280, 800],
		['full HD', 1_920, 1_080],
		['ultrawide', 3_440, 1_440],
		['tablet portrait', 768, 1_024],
		['phone', 390, 844],
		['phone landscape', 844, 390]
	])('shows the reference range on a %s screen', (_name, screenWidth, screenHeight) => {
		const aspect = Math.max(screenWidth / screenHeight, STAGE_FILL_MIN_ASPECT);
		const preview = previewOffset(saved, REFERENCE_WIDTH, REFERENCE_HEIGHT);
		const shown = previewOffset(saved, 1_000 * aspect, 1_000);

		expect(stageAspectScale(1_000 * aspect, 1_000)).toBeCloseTo(0.85, 10);
		expect(shown.rangeMeters).toBeCloseTo(preview.rangeMeters, 6);
		expect(shown.rangeMeters / saved.rangeMeters).toBeCloseTo(0.85, 6);
	});

	it('round-trips a saved range through the reference stage', () => {
		const shown = previewOffset(saved, REFERENCE_WIDTH, REFERENCE_HEIGHT);
		const read = editorialPoseFromOffset(
			0,
			shown.rangeMeters,
			0,
			REFERENCE_WIDTH,
			REFERENCE_HEIGHT
		);

		expect(read.rangeMeters).toBeCloseTo(saved.rangeMeters, 6);
	});
});

describe('cesium camera offset', () => {
	it('converts the look direction to radians and leaves the range unchanged', () => {
		const offset = cesiumCameraOffset({
			headingDegrees: 90,
			pitchDegrees: -22,
			rollDegrees: 0,
			rangeMeters: 6_800,
			baseRangeMeters: 8_000,
			dropMeters: 2_000,
			framingX: 0,
			framingY: 0,
			source: 'terrain'
		});

		expect(offset.headingRadians).toBeCloseTo(Math.PI / 2, 10);
		expect(offset.pitchRadians).toBeCloseTo((-22 * Math.PI) / 180, 10);
		expect(offset.rollRadians).toBe(0);
		expect(offset.rangeMeters).toBe(6_800);
	});
});
