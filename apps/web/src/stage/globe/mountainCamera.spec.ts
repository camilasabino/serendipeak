import { describe, expect, it, vi } from 'vitest';
import type { SceneTarget } from './camera';
import { RESET_FLIGHT_SECONDS, type CameraDirector, type CameraOutcome } from './choreography';
import type { TransitionJourney } from './glidePath';
import { createMountainCamera, type MountainCameraDirector } from './mountainCamera';
import type { SummitMarkerDisplay } from './marker';
import type { StageSize } from './stageFrame';
import {
	createTerrainCameraSession,
	poseForStage,
	stageAspectScale,
	type CesiumCameraOffset,
	type TerrainCameraPose
} from './terrainCamera';

const NARROW: StageSize = { width: 560, height: 762 };
const WIDE: StageSize = { width: 895, height: 468 };
const SMALL_DRAG: StageSize = { width: 600, height: 762 };

const POSE: TerrainCameraPose = {
	headingDegrees: 90,
	pitchDegrees: -22,
	rollDegrees: 0,
	rangeMeters: 1,
	baseRangeMeters: 10_000,
	dropMeters: 1_299,
	framingX: 0,
	framingY: 0,
	source: 'terrain'
};

const ACONCAGUA: SceneTarget = {
	slug: 'aconcagua',
	name: 'Aconcagua',
	latitude: -32.65,
	longitude: -70.01,
	elevationMeters: 6961
};

const FUJI: SceneTarget = {
	slug: 'mount-fuji',
	name: 'Mount Fuji',
	latitude: 35.36,
	longitude: 138.73,
	elevationMeters: 3776
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createDirector() {
	const place = vi.fn(
		(
			_target: SceneTarget,
			_offset: CesiumCameraOffset,
			onSettled?: (outcome: CameraOutcome) => void
		) => {
			onSettled?.({ status: 'arrived' });
		}
	);
	const travel = vi.fn(
		(
			_target: SceneTarget,
			_offset: CesiumCameraOffset,
			_journey: TransitionJourney,
			onSettled?: (outcome: CameraOutcome) => void
		) => {
			onSettled?.({ status: 'arrived' });
		}
	);
	const reframe = vi.fn<CameraDirector['reframe']>((_target, _offset, _animate, onSettled) => {
		onSettled?.();
		return true;
	});
	const director: MountainCameraDirector = {
		place,
		travel,
		reframe,
		busy: () => false,
		stop: vi.fn()
	};
	return { director, place, travel, reframe };
}

function createMarkers() {
	return {
		show: vi.fn(),
		hide: vi.fn()
	} satisfies SummitMarkerDisplay;
}

describe('createMountainCamera', () => {
	it('hands the initial mountain to the director as a reveal from the terrain pose', async () => {
		const { director, place, travel } = createDirector();
		const resolvePose = vi.fn(async () => POSE);
		const camera = createMountainCamera({
			resolvePose,
			measure: () => NARROW,
			reducedMotion: () => false,
			director,
			markers: createMarkers()
		});

		await camera.show(ACONCAGUA, 'initial');

		expect(place).not.toHaveBeenCalled();
		expect(travel).toHaveBeenCalledOnce();
		expect(travel.mock.calls[0]![2]).toBe('reveal');
		const offset = travel.mock.calls[0]![1];
		expect(offset.rangeMeters).toBe(12_500);
		expect(offset.headingRadians).toBeCloseTo(Math.PI / 2, 10);
		expect(offset.pitchRadians).toBeCloseTo((-22 * Math.PI) / 180, 10);
		expect(resolvePose).toHaveBeenCalledExactlyOnceWith(ACONCAGUA, NARROW);
	});

	it('hands the next mountain to the director as an explore transition', async () => {
		const { director, place, travel } = createDirector();
		const markers = createMarkers();
		const pending = deferred<TerrainCameraPose>();
		const camera = createMountainCamera({
			resolvePose: vi.fn(() => pending.promise),
			measure: () => NARROW,
			reducedMotion: () => false,
			director,
			markers
		});

		const showing = camera.show(FUJI, 'next');
		expect(markers.hide).toHaveBeenCalledOnce();
		expect(travel).not.toHaveBeenCalled();

		pending.resolve(POSE);
		await showing;

		expect(place).not.toHaveBeenCalled();
		expect(travel).toHaveBeenCalledOnce();
		expect(travel.mock.calls[0]![0]).toEqual(FUJI);
		expect(travel.mock.calls[0]![1].rangeMeters).toBe(12_500);
		expect(travel.mock.calls[0]![2]).toBe('explore');
	});

	it('reuses one terrain session and does not sample again on a structural reframe', async () => {
		const samples: string[] = [];
		const session = createTerrainCameraSession();
		const terrain = {
			async sampleHeights() {
				samples.push('sample');
				return Array.from({ length: 17 }, () => 1_000);
			}
		};
		const { director, reframe } = createDirector();
		let size = NARROW;
		const camera = createMountainCamera({
			resolvePose: (target, stage) =>
				session.resolve({
					slug: target.slug,
					latitude: target.latitude,
					longitude: target.longitude,
					elevationMeters: target.elevationMeters,
					stageWidth: stage.width,
					stageHeight: stage.height,
					terrain,
					camera: target.camera
				}),
			measure: () => size,
			reducedMotion: () => false,
			director,
			markers: createMarkers()
		});

		await camera.show(ACONCAGUA, 'initial');
		await camera.show(FUJI, 'next');
		await camera.show(ACONCAGUA, 'next');
		expect(samples).toHaveLength(2);

		camera.updateStage(SMALL_DRAG);
		expect(reframe).not.toHaveBeenCalled();
		expect(samples).toHaveLength(2);

		size = WIDE;
		camera.updateStage(WIDE);

		expect(samples).toHaveLength(2);
		expect(reframe).toHaveBeenCalledOnce();
		expect(reframe.mock.calls[0]![0]).toEqual(ACONCAGUA);
		expect(reframe.mock.calls[0]![1].rangeMeters).toBe(11_900);
		expect(reframe.mock.calls[0]![2]).toBe(true);
	});

	it('places a curated mountain without sampling and flies between pose sources', async () => {
		const samples: string[] = [];
		const session = createTerrainCameraSession();
		const curated = { headingDegrees: 200, pitchDegrees: -18, rangeMeters: 8_000 };
		const popo: SceneTarget = { ...FUJI, slug: 'popocatepetl', camera: curated };
		const { director, travel } = createDirector();
		const camera = createMountainCamera({
			resolvePose: (target, stage) =>
				session.resolve({
					slug: target.slug,
					latitude: target.latitude,
					longitude: target.longitude,
					elevationMeters: target.elevationMeters,
					stageWidth: stage.width,
					stageHeight: stage.height,
					terrain: {
						async sampleHeights() {
							samples.push(target.slug);
							return Array.from({ length: 17 }, () => 1_000);
						}
					},
					camera: target.camera
				}),
			measure: () => NARROW,
			reducedMotion: () => false,
			director,
			markers: createMarkers()
		});

		await camera.show(popo, 'initial');
		await camera.show(ACONCAGUA, 'next');
		await camera.show(popo, 'next');
		await camera.show({ ...FUJI, camera: curated }, 'next');

		expect(samples).toEqual(['aconcagua']);
		expect(travel).toHaveBeenCalledTimes(4);
		expect(travel.mock.calls.map((call) => call[2])).toEqual([
			'reveal',
			'explore',
			'explore',
			'explore'
		]);
		expect(travel.mock.calls[0]![1].headingRadians).toBeCloseTo((200 * Math.PI) / 180);
		expect(travel.mock.calls[0]![1].pitchRadians).toBeCloseTo((-18 * Math.PI) / 180);
		expect(travel.mock.calls[0]![1].rangeMeters).toBe(8_000 * 1.25);
		expect(travel.mock.calls[3]![0].slug).toBe('mount-fuji');
		expect(travel.mock.calls[3]![1].headingRadians).toBeCloseTo((200 * Math.PI) / 180);
	});

	it('reframes a curated pose without sampling', async () => {
		const samples: string[] = [];
		const session = createTerrainCameraSession();
		const curated = { headingDegrees: 200, pitchDegrees: -18, rangeMeters: 8_000 };
		const popo: SceneTarget = { ...ACONCAGUA, camera: curated };
		const { director, reframe } = createDirector();
		const camera = createMountainCamera({
			resolvePose: (target, stage) =>
				session.resolve({
					slug: target.slug,
					latitude: target.latitude,
					longitude: target.longitude,
					elevationMeters: target.elevationMeters,
					stageWidth: stage.width,
					stageHeight: stage.height,
					terrain: {
						async sampleHeights() {
							samples.push('sample');
							return Array.from({ length: 17 }, () => 1_000);
						}
					},
					camera: target.camera
				}),
			measure: () => NARROW,
			reducedMotion: () => false,
			director,
			markers: createMarkers()
		});

		await camera.show(popo, 'initial');
		camera.updateStage(WIDE);

		expect(samples).toHaveLength(0);
		expect(reframe).toHaveBeenCalledOnce();
		expect(reframe.mock.calls[0]![1].headingRadians).toBeCloseTo((200 * Math.PI) / 180);
		expect(reframe.mock.calls[0]![1].pitchRadians).toBeCloseTo((-18 * Math.PI) / 180);
		expect(reframe.mock.calls[0]![1].rangeMeters).toBe(8_000 * 0.85);
	});

	it('reframes a fallback pose without sampling again', async () => {
		const samples: string[] = [];
		const session = createTerrainCameraSession();
		const { director, travel, reframe } = createDirector();
		const camera = createMountainCamera({
			resolvePose: (target, stage) =>
				session.resolve({
					slug: target.slug,
					latitude: target.latitude,
					longitude: target.longitude,
					elevationMeters: target.elevationMeters,
					stageWidth: stage.width,
					stageHeight: stage.height,
					terrain: {
						async sampleHeights() {
							samples.push(target.slug);
							throw new Error('tile');
						}
					}
				}),
			measure: () => ({ width: 1350, height: 1000 }),
			reducedMotion: () => true,
			director,
			markers: createMarkers()
		});

		await camera.show(ACONCAGUA, 'initial');
		camera.updateStage(WIDE);

		expect(samples).toEqual(['aconcagua']);
		expect(travel.mock.calls[0]![1].rangeMeters).toBe(11_000);
		expect(travel.mock.calls[0]![1].headingRadians).toBe(0);
		expect(reframe).toHaveBeenCalledOnce();
		expect(reframe.mock.calls[0]![1].rangeMeters).toBe(11_000 * 0.85);
		expect(reframe.mock.calls[0]![2]).toBe(false);
	});

	it('keeps a remembered editor pose when a later reframe arrives', async () => {
		const { director, reframe } = createDirector();
		let size = NARROW;
		const camera = createMountainCamera({
			resolvePose: async () => POSE,
			measure: () => size,
			reducedMotion: () => false,
			director,
			markers: createMarkers()
		});
		const selected: TerrainCameraPose = {
			headingDegrees: 120.25,
			pitchDegrees: -12.4,
			rollDegrees: 0,
			rangeMeters: 15_000,
			baseRangeMeters: 15_000,
			dropMeters: null,
			framingX: -0.12,
			framingY: 0.18,
			source: 'curated'
		};

		await camera.show(ACONCAGUA, 'initial');
		camera.remember(poseForStage(selected, NARROW.width, NARROW.height), NARROW);
		size = WIDE;
		camera.updateStage(WIDE);

		expect(reframe).toHaveBeenCalledOnce();
		expect(reframe.mock.calls[0]![1].headingRadians).toBeCloseTo((120.25 * Math.PI) / 180);
		expect(reframe.mock.calls[0]![1].framingX).toBeCloseTo(-0.12, 5);
		expect(reframe.mock.calls[0]![1].framingY).toBeCloseTo(0.18, 5);
		expect(reframe.mock.calls[0]![1].rangeMeters).toBe(
			15_000 * stageAspectScale(WIDE.width, WIDE.height)
		);
	});

	it('does not place a mountain after the camera was stopped', async () => {
		const { director, travel } = createDirector();
		const pending = deferred<TerrainCameraPose>();
		const camera = createMountainCamera({
			resolvePose: () => pending.promise,
			measure: () => NARROW,
			reducedMotion: () => false,
			director,
			markers: createMarkers()
		});

		const showing = camera.show(ACONCAGUA, 'initial');
		camera.stop();
		pending.resolve(POSE);

		await expect(showing).resolves.toEqual({ status: 'interrupted' });
		expect(travel).not.toHaveBeenCalled();
		expect(director.stop).toHaveBeenCalledOnce();
	});
});

describe('MountainCamera.reset', () => {
	const MATTERHORN: SceneTarget = {
		slug: 'matterhorn',
		name: 'Matterhorn',
		latitude: 45.9763,
		longitude: 7.6586,
		elevationMeters: 4478,
		camera: {
			headingDegrees: 212.4,
			pitchDegrees: 3.1,
			rangeMeters: 11_200,
			framing: { x: 0.31, y: -0.22 }
		}
	};
	const EVEREST: SceneTarget = {
		slug: 'mount-everest',
		name: 'Mount Everest',
		latitude: 27.9881,
		longitude: 86.925,
		elevationMeters: 8849,
		camera: { headingDegrees: 40, pitchDegrees: -17, rangeMeters: 21_000 }
	};

	function setup(overrides: { reducedMotion?: boolean; isAtPose?: () => boolean } = {}) {
		const samples: string[] = [];
		const session = createTerrainCameraSession();
		const terrain = {
			async sampleHeights() {
				samples.push('sample');
				return Array.from({ length: 17 }, () => 1_000);
			}
		};
		const { director, reframe, travel } = createDirector();
		let size = NARROW;
		const camera = createMountainCamera({
			resolvePose: (target, stage) =>
				session.resolve({
					slug: target.slug,
					latitude: target.latitude,
					longitude: target.longitude,
					elevationMeters: target.elevationMeters,
					stageWidth: stage.width,
					stageHeight: stage.height,
					terrain,
					camera: target.camera
				}),
			measure: () => size,
			reducedMotion: () => overrides.reducedMotion ?? false,
			director,
			markers: createMarkers(),
			isAtPose: overrides.isAtPose
		});
		return {
			camera,
			reframe,
			travel,
			director,
			samples,
			resize(next: StageSize) {
				size = next;
			}
		};
	}

	it('returns to the canonical curated pose of the presented mountain', async () => {
		const { camera, reframe } = setup();
		await camera.show(MATTERHORN, 'initial');

		expect(camera.reset()).toBe('reset');

		expect(reframe).toHaveBeenCalledOnce();
		const [target, offset, animate, , options] = reframe.mock.calls[0]!;
		expect(target).toEqual(MATTERHORN);
		expect(offset.headingRadians).toBeCloseTo((212.4 * Math.PI) / 180, 10);
		expect(offset.pitchRadians).toBeCloseTo((3.1 * Math.PI) / 180, 10);
		expect(offset.rollRadians).toBe(0);
		expect(offset.rangeMeters).toBeCloseTo(
			11_200 * stageAspectScale(NARROW.width, NARROW.height),
			6
		);
		expect(offset.framingX).toBeCloseTo(0.31, 10);
		expect(offset.framingY).toBeCloseTo(-0.22, 10);
		expect(animate).toBe(true);
		expect(options).toEqual({ supersede: true, durationSeconds: RESET_FLIGHT_SECONDS });
	});

	it('uses the same pose as the arrival for the current stage dimensions', async () => {
		const { camera, travel, reframe, resize } = setup();
		await camera.show(MATTERHORN, 'initial');
		const arrival = travel.mock.calls[0]![1];

		camera.reset();

		expect(reframe.mock.calls[0]![1]).toEqual(arrival);

		resize(WIDE);
		camera.reset();

		expect(reframe.mock.calls[1]![1].rangeMeters).toBeCloseTo(
			11_200 * stageAspectScale(WIDE.width, WIDE.height),
			6
		);
		expect(reframe.mock.calls[1]![1].headingRadians).toBe(arrival.headingRadians);
	});

	it('never samples terrain, neither before nor during a reset', async () => {
		const { camera, samples } = setup();
		await camera.show(MATTERHORN, 'initial');
		expect(samples).toHaveLength(0);

		camera.reset();
		camera.reset();

		expect(samples).toHaveLength(0);
	});

	it('does not re-resolve the pose when resetting', async () => {
		const resolvePose = vi.fn(async () => POSE);
		const { director, reframe } = createDirector();
		const camera = createMountainCamera({
			resolvePose,
			measure: () => NARROW,
			reducedMotion: () => false,
			director,
			markers: createMarkers()
		});
		await camera.show(ACONCAGUA, 'initial');

		camera.reset();

		expect(resolvePose).toHaveBeenCalledOnce();
		expect(reframe).toHaveBeenCalledOnce();
	});

	it('jumps to the pose when the user prefers reduced motion', async () => {
		const { camera, reframe } = setup({ reducedMotion: true });
		await camera.show(MATTERHORN, 'initial');

		camera.reset();

		expect(reframe.mock.calls[0]![2]).toBe(false);
	});

	it('does nothing when the camera is already at the pose', async () => {
		const isAtPose = vi.fn(() => true);
		const { camera, reframe } = setup({ isAtPose });
		await camera.show(MATTERHORN, 'initial');

		expect(camera.reset()).toBe('unchanged');

		expect(isAtPose).toHaveBeenCalledOnce();
		expect(isAtPose.mock.calls[0]).toEqual([MATTERHORN, expect.anything()]);
		expect(reframe).not.toHaveBeenCalled();
	});

	it('resets even when the pose check matches while the director is busy', async () => {
		const { camera, director, reframe } = setup({ isAtPose: () => true });
		await camera.show(MATTERHORN, 'initial');
		director.busy = () => true;

		expect(camera.reset()).toBe('reset');
		expect(reframe).toHaveBeenCalledOnce();
	});

	it('targets the destination after an Explore transition', async () => {
		const { camera, reframe } = setup();
		await camera.show(MATTERHORN, 'initial');
		await camera.show(EVEREST, 'next');

		camera.reset();

		expect(reframe.mock.calls[0]![0]).toEqual(EVEREST);
		expect(reframe.mock.calls[0]![1].headingRadians).toBeCloseTo((40 * Math.PI) / 180, 10);
		expect(reframe.mock.calls[0]![1].framingX).toBe(0);
	});

	it('is unavailable before the first arrival and while a new mountain is in flight', async () => {
		const pending = deferred<TerrainCameraPose>();
		const { director, reframe } = createDirector();
		let resolve = async (): Promise<TerrainCameraPose> => POSE;
		const camera = createMountainCamera({
			resolvePose: () => resolve(),
			measure: () => NARROW,
			reducedMotion: () => false,
			director,
			markers: createMarkers()
		});

		expect(camera.reset()).toBe('unavailable');

		await camera.show(ACONCAGUA, 'initial');
		resolve = () => pending.promise;
		const next = camera.show(FUJI, 'next');

		expect(camera.reset()).toBe('unavailable');
		expect(reframe).not.toHaveBeenCalled();

		pending.resolve(POSE);
		await next;

		expect(camera.reset()).toBe('reset');
	});

	it('reports unavailable and keeps its state when the director refuses', async () => {
		const { camera, director, reframe } = setup();
		await camera.show(MATTERHORN, 'initial');
		reframe.mockReturnValueOnce(false);

		expect(camera.reset()).toBe('unavailable');

		director.busy = () => false;
		expect(camera.reset()).toBe('reset');
	});

	it('discards a queued stage change because the reset already uses the latest stage', async () => {
		const { camera, director, reframe, resize } = setup();
		await camera.show(MATTERHORN, 'initial');
		director.busy = () => true;
		resize(WIDE);
		camera.updateStage(WIDE);
		expect(reframe).not.toHaveBeenCalled();

		camera.reset();
		const settled = reframe.mock.calls[0]![3];
		director.busy = () => false;
		settled?.();

		expect(reframe).toHaveBeenCalledOnce();
		expect(reframe.mock.calls[0]![1].rangeMeters).toBeCloseTo(
			11_200 * stageAspectScale(WIDE.width, WIDE.height),
			6
		);
	});

	it('is unavailable after stop', async () => {
		const { camera, reframe } = setup();
		await camera.show(MATTERHORN, 'initial');

		camera.stop();

		expect(camera.reset()).toBe('unavailable');
		expect(reframe).not.toHaveBeenCalled();
	});
});

describe('MountainCamera stage changes with a user-moved camera', () => {
	const TARGET: SceneTarget = {
		slug: 'matterhorn',
		name: 'Matterhorn',
		latitude: 45.9763,
		longitude: 7.6586,
		elevationMeters: 4478,
		camera: { headingDegrees: 211.46, pitchDegrees: -11.59, rangeMeters: 6_492 }
	};

	function setup(moved: boolean) {
		const session = createTerrainCameraSession();
		const { director, reframe } = createDirector();
		const hasMovedFrom = vi.fn<(target: SceneTarget, offset: CesiumCameraOffset) => boolean>(
			() => moved
		);
		let size = NARROW;
		const camera = createMountainCamera({
			resolvePose: (target, stage) =>
				session.resolve({
					slug: target.slug,
					latitude: target.latitude,
					longitude: target.longitude,
					elevationMeters: target.elevationMeters,
					stageWidth: stage.width,
					stageHeight: stage.height,
					terrain: null,
					camera: target.camera
				}),
			measure: () => size,
			reducedMotion: () => false,
			director,
			markers: createMarkers(),
			hasMovedFrom
		});
		return {
			camera,
			reframe,
			hasMovedFrom,
			resize(next: StageSize) {
				size = next;
				camera.updateStage(next);
			}
		};
	}

	it('keeps the camera where the user left it when the stage changes structurally', async () => {
		const { camera, reframe, hasMovedFrom, resize } = setup(true);
		await camera.show(TARGET, 'initial');

		resize(WIDE);

		expect(hasMovedFrom).toHaveBeenCalledOnce();
		expect(hasMovedFrom.mock.calls[0]![1].rangeMeters).toBeCloseTo(
			6_492 * stageAspectScale(NARROW.width, NARROW.height),
			6
		);
		expect(reframe).not.toHaveBeenCalled();
	});

	it('still reframes a camera that is at its canonical pose', async () => {
		const { camera, reframe, resize } = setup(false);
		await camera.show(TARGET, 'initial');

		resize(WIDE);

		expect(reframe).toHaveBeenCalledOnce();
	});

	it('resets to the canonical pose of the current stage after a user-moved stage change', async () => {
		const { camera, reframe, resize } = setup(true);
		await camera.show(TARGET, 'initial');
		resize(WIDE);

		expect(camera.reset()).toBe('reset');

		expect(reframe).toHaveBeenCalledOnce();
		expect(reframe.mock.calls[0]![1].rangeMeters).toBeCloseTo(
			6_492 * stageAspectScale(WIDE.width, WIDE.height),
			6
		);
	});

	it('does not repeat the check for a small drag that is not a structural change', async () => {
		const { camera, hasMovedFrom, resize } = setup(true);
		await camera.show(TARGET, 'initial');

		resize(SMALL_DRAG);

		expect(hasMovedFrom).not.toHaveBeenCalled();
	});
});
