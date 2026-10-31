import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SceneTarget } from './camera';
import type { CameraDirector } from './choreography';
import { createMountainCamera } from './mountainCamera';
import type { StageSize } from './stageFrame';
import {
	cesiumCameraOffset,
	createTerrainCameraSession,
	poseForStage,
	stageAspectScale
} from './terrainCamera';

const CATALOG_PATH = '../../../../../contracts/v1/catalog.json';
const STAGES: StageSize[] = [
	{ width: 1037, height: 786 },
	{ width: 1440, height: 900 },
	{ width: 390, height: 439 },
	{ width: 320, height: 390 }
];

interface CatalogMountain {
	slug: string;
	camera?: {
		headingDegrees: number;
		pitchDegrees: number;
		rangeMeters: number;
		framing?: { x: number; y: number };
	};
}

function catalogCameras(): Map<string, Record<string, number>> {
	const catalog: { mountains: CatalogMountain[] } = JSON.parse(
		readFileSync(new URL(CATALOG_PATH, import.meta.url), 'utf8')
	);
	const entries = new Map<string, Record<string, number>>();
	for (const { slug, camera } of catalog.mountains) {
		const fields: Record<string, number> = {};
		if (camera) {
			fields.headingDegrees = camera.headingDegrees;
			fields.pitchDegrees = camera.pitchDegrees;
			fields.rangeMeters = camera.rangeMeters;
			if (camera.framing) {
				fields.x = camera.framing.x;
				fields.y = camera.framing.y;
			}
		}
		entries.set(slug, fields);
	}
	return entries;
}

function targetFor(slug: string, fields: Record<string, number>): SceneTarget {
	return {
		slug,
		name: slug,
		latitude: 10,
		longitude: 20,
		elevationMeters: 3000,
		camera: {
			headingDegrees: fields.headingDegrees!,
			pitchDegrees: fields.pitchDegrees!,
			rangeMeters: fields.rangeMeters!,
			framing: { x: fields.x!, y: fields.y! }
		}
	};
}

describe('canonical catalog cameras', () => {
	const cameras = catalogCameras();

	it('covers the 73 published mountains with a complete curated camera', () => {
		expect(cameras.size).toBe(73);
		for (const [slug, fields] of cameras) {
			for (const key of ['headingDegrees', 'pitchDegrees', 'rangeMeters', 'x', 'y']) {
				expect(Number.isFinite(fields[key]), `${slug} ${key}`).toBe(true);
			}
		}
	});

	it('keeps every camera inside the published bounds', () => {
		for (const [slug, f] of cameras) {
			expect(f.headingDegrees, slug).toBeGreaterThanOrEqual(0);
			expect(f.headingDegrees, slug).toBeLessThan(360);
			expect(f.pitchDegrees, slug).toBeGreaterThanOrEqual(-60);
			expect(f.pitchDegrees, slug).toBeLessThanOrEqual(15);
			expect(f.rangeMeters, slug).toBeGreaterThanOrEqual(2000);
			expect(f.rangeMeters, slug).toBeLessThanOrEqual(80_000);
			expect(Math.abs(f.x!), slug).toBeLessThanOrEqual(1);
			expect(Math.abs(f.y!), slug).toBeLessThanOrEqual(1);
		}
	});

	it('derives the Reset pose of every mountain deterministically and without sampling terrain', async () => {
		const sampleHeights = vi.fn(async () => {
			throw new Error('terrain must not be sampled');
		});
		const session = createTerrainCameraSession();
		let size = STAGES[0];

		for (const [slug, fields] of cameras) {
			const target = targetFor(slug, fields);
			const reframe = vi.fn<CameraDirector['reframe']>(() => true);
			const director = {
				place: vi.fn(),
				travel: vi.fn((_target, _offset, _journey, onSettled) =>
					onSettled?.({ status: 'arrived' })
				),
				reframe,
				busy: () => false,
				stop: vi.fn()
			} as unknown as CameraDirector;
			const camera = createMountainCamera({
				resolvePose: (mountain, stage) =>
					session.resolve({
						slug: mountain.slug,
						latitude: mountain.latitude,
						longitude: mountain.longitude,
						elevationMeters: mountain.elevationMeters,
						stageWidth: stage.width,
						stageHeight: stage.height,
						terrain: { sampleHeights },
						camera: mountain.camera
					}),
				measure: () => size!,
				reducedMotion: () => false,
				director,
				markers: { show: vi.fn(), hide: vi.fn() }
			});
			await camera.show(target, 'initial');

			for (const stage of STAGES) {
				size = stage;
				expect(camera.reset(), `${slug} ${stage.width}x${stage.height}`).toBe('reset');
				const offset = reframe.mock.calls.at(-1)![1];
				const expected = cesiumCameraOffset(
					poseForStage(
						{
							headingDegrees: fields.headingDegrees!,
							pitchDegrees: fields.pitchDegrees!,
							rollDegrees: 0,
							rangeMeters: 0,
							baseRangeMeters: fields.rangeMeters!,
							dropMeters: null,
							framingX: fields.x!,
							framingY: fields.y!,
							source: 'curated'
						},
						stage.width,
						stage.height
					)
				);
				expect(offset, `${slug} ${stage.width}x${stage.height}`).toEqual(expected);
				expect(offset.rollRadians).toBe(0);
				expect(offset.rangeMeters).toBeCloseTo(
					fields.rangeMeters! * stageAspectScale(stage.width, stage.height),
					6
				);
				expect(Number.isFinite(offset.headingRadians)).toBe(true);
				expect(Number.isFinite(offset.pitchRadians)).toBe(true);
			}
			size = STAGES[0];
			camera.stop();
		}

		expect(sampleHeights).not.toHaveBeenCalled();
	});
});
