import type { SceneTarget } from './camera';
import { RESET_FLIGHT_SECONDS, type CameraDirector, type CameraOutcome } from './choreography';
import type { SummitMarkerDisplay } from './marker';
import { isStructuralAspectChange, stageAspect, type StageSize } from './stageFrame';
import {
	cesiumCameraOffset,
	poseForStage,
	type CesiumCameraOffset,
	type TerrainCameraPose
} from './terrainCamera';

export type MountainPlacement = 'initial' | 'next';

export type MountainCameraDirector = Pick<
	CameraDirector,
	'place' | 'travel' | 'reframe' | 'busy' | 'release' | 'stop'
>;

export type ResetResult = 'reset' | 'unchanged' | 'unavailable';

export interface MountainCamera {
	show(target: SceneTarget, placement: MountainPlacement): Promise<CameraOutcome>;
	remember(pose: TerrainCameraPose, size: StageSize): void;
	reset(): ResetResult;
	updateStage(size: StageSize): void;
	/** Forgets the presented mountain and its pose; unlike stop(), later shows still work. */
	clear(): void;
	stop(): void;
}

interface MountainCameraOptions {
	resolvePose: (target: SceneTarget, stage: StageSize) => Promise<TerrainCameraPose>;
	measure: () => StageSize;
	reducedMotion: () => boolean;
	director: MountainCameraDirector;
	markers: SummitMarkerDisplay;
	isAtPose?: (target: SceneTarget, offset: CesiumCameraOffset) => boolean;
	hasMovedFrom?: (target: SceneTarget, offset: CesiumCameraOffset) => boolean;
}

export function createMountainCamera({
	resolvePose,
	measure,
	reducedMotion,
	director,
	markers,
	isAtPose = () => false,
	hasMovedFrom = () => false
}: MountainCameraOptions): MountainCamera {
	let ticket = 0;
	let arrivedTicket = 0;
	let stopped = false;
	let activeTarget: SceneTarget | undefined;
	let activePose: TerrainCameraPose | undefined;
	let framedAspect = 0;
	let pendingStage: StageSize | undefined;

	function current(): boolean {
		return !stopped;
	}

	function drainPendingStage() {
		const queued = pendingStage;
		pendingStage = undefined;
		if (queued) {
			applyReframe(queued);
		}
	}

	function applyReframe(size: StageSize): boolean {
		if (!activePose || !activeTarget || director.busy()) {
			return false;
		}
		const nextAspect = stageAspect(size);
		if (!isStructuralAspectChange(framedAspect, nextAspect)) {
			return true;
		}
		const pose = poseForStage(activePose, size.width, size.height);
		const previousPose = activePose;
		const previousAspect = framedAspect;
		const moved = hasMovedFrom(activeTarget, cesiumCameraOffset(previousPose));
		activePose = pose;
		framedAspect = nextAspect;
		if (moved) {
			return true;
		}
		const started = director.reframe(
			activeTarget,
			cesiumCameraOffset(pose),
			!reducedMotion(),
			drainPendingStage
		);
		if (!started) {
			activePose = previousPose;
			framedAspect = previousAspect;
			return false;
		}
		return true;
	}

	return {
		async show(target, placement) {
			const mine = ++ticket;
			if (placement === 'next') {
				markers.hide();
			}

			let pose: TerrainCameraPose;
			try {
				pose = await resolvePose(target, measure());
			} catch (error) {
				if (mine !== ticket || stopped) {
					return { status: 'interrupted' };
				}
				return { status: 'failed', error };
			}

			if (mine !== ticket || !current()) {
				return { status: 'interrupted' };
			}

			const size = measure();
			const framed = poseForStage(pose, size.width, size.height);
			const offset = cesiumCameraOffset(framed);
			const outcome = await new Promise<CameraOutcome>((resolve) => {
				director.travel(target, offset, placement === 'initial' ? 'reveal' : 'explore', resolve);
			});

			if (mine !== ticket || !current()) {
				return { status: 'interrupted' };
			}

			if (outcome.status === 'arrived') {
				activeTarget = target;
				activePose = framed;
				framedAspect = stageAspect(size);
				arrivedTicket = mine;
			}

			drainPendingStage();

			return outcome;
		},
		reset() {
			if (stopped || !activePose || !activeTarget || arrivedTicket !== ticket) {
				return 'unavailable';
			}
			const size = measure();
			if (!(stageAspect(size) > 0)) {
				return 'unavailable';
			}
			const pose = poseForStage(activePose, size.width, size.height);
			const offset = cesiumCameraOffset(pose);
			if (!director.busy() && isAtPose(activeTarget, offset)) {
				return 'unchanged';
			}
			const previous = { pose: activePose, aspect: framedAspect, pending: pendingStage };
			activePose = pose;
			framedAspect = stageAspect(size);
			pendingStage = undefined;
			const started = director.reframe(activeTarget, offset, !reducedMotion(), drainPendingStage, {
				supersede: true,
				durationSeconds: RESET_FLIGHT_SECONDS
			});
			if (!started) {
				activePose = previous.pose;
				framedAspect = previous.aspect;
				pendingStage = previous.pending;
				return 'unavailable';
			}
			return 'reset';
		},
		remember(pose, size) {
			if (stopped || !activeTarget) {
				return;
			}
			activePose = pose;
			framedAspect = stageAspect(size);
		},
		updateStage(size) {
			if (!activePose || !activeTarget) {
				return;
			}
			if (!isStructuralAspectChange(framedAspect, stageAspect(size))) {
				return;
			}
			if (!applyReframe(size)) {
				pendingStage = size;
			}
		},
		clear() {
			if (stopped) {
				return;
			}
			ticket += 1;
			pendingStage = undefined;
			activeTarget = undefined;
			activePose = undefined;
			director.release();
		},
		stop() {
			stopped = true;
			ticket += 1;
			pendingStage = undefined;
			activeTarget = undefined;
			activePose = undefined;
			director.stop();
		}
	};
}
