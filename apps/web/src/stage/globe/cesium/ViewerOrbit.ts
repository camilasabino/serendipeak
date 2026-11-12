import type { Cartesian3, Viewer } from 'cesium';
import type { CesiumModule } from './CesiumModule';

// A frame later than this (a stalled tab, a debugger) turns the globe by this much and no more.
const MAX_FRAME_SECONDS = 0.1;
// Beyond these the camera was moved by someone else since the last turn, and it is theirs now.
const EXTERNAL_MOVE_METERS = 1;
const EXTERNAL_TURN = 1e-4;

interface OrbitRun {
	periodSeconds: number;
	onHalted: () => void;
	removeFrame: () => void;
	lastFrameAt: number | undefined;
	applied: Cartesian3;
	appliedDirection: Cartesian3;
}

/**
 * Ambient motion for a free globe: each frame turns the camera's position and axes about the polar
 * axis, so altitude, tilt and framing stay fixed while the world drifts beneath. It never fights
 * anyone else for the camera; the first move it did not make ends it. A hidden page renders no
 * frames, and the clock restarts when it comes back so the globe never jumps.
 */
export class ViewerOrbit {
	private run: OrbitRun | undefined;
	private readonly rotation: InstanceType<CesiumModule['Matrix3']>;
	private readonly scratchPosition: Cartesian3;
	private readonly scratchDirection: Cartesian3;
	private readonly scratchUp: Cartesian3;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer,
		private readonly allowed: () => boolean
	) {
		this.rotation = new cesium.Matrix3();
		this.scratchPosition = new cesium.Cartesian3();
		this.scratchDirection = new cesium.Cartesian3();
		this.scratchUp = new cesium.Cartesian3();
	}

	get running(): boolean {
		return this.run !== undefined;
	}

	start(periodSeconds: number, onHalted: () => void): boolean {
		this.stop();
		if (this.viewer.isDestroyed() || !(periodSeconds > 0) || !this.allowed()) {
			return false;
		}

		const { Cartesian3 } = this.cesium;
		const { camera, scene } = this.viewer;
		const run: OrbitRun = {
			periodSeconds,
			onHalted,
			removeFrame: () => {},
			lastFrameAt: undefined,
			applied: Cartesian3.clone(camera.positionWC),
			appliedDirection: Cartesian3.clone(camera.directionWC)
		};
		this.run = run;
		run.removeFrame = scene.preUpdate.addEventListener(() => this.turn(run));

		return true;
	}

	/**
	 * Takes the camera as it is now for the pose the orbit left it in, so a move its owner made on
	 * purpose, such as refitting the range, does not read as someone else's and halt the turn.
	 */
	adopt(): void {
		const run = this.run;
		if (!run) {
			return;
		}

		const { Cartesian3 } = this.cesium;
		const { camera } = this.viewer;
		Cartesian3.clone(camera.positionWC, run.applied);
		Cartesian3.clone(camera.directionWC, run.appliedDirection);
	}

	stop(): void {
		const run = this.run;
		this.run = undefined;
		run?.removeFrame();
	}

	private halt(run: OrbitRun): void {
		if (this.run !== run) {
			return;
		}
		this.stop();
		run.onHalted();
	}

	private turn(run: OrbitRun): void {
		if (this.run !== run) {
			return;
		}
		const { Cartesian3, Matrix3, Matrix4 } = this.cesium;
		const { camera } = this.viewer;

		const moved = !Cartesian3.equalsEpsilon(
			camera.positionWC,
			run.applied,
			0,
			EXTERNAL_MOVE_METERS
		);
		const turned = !Cartesian3.equalsEpsilon(
			camera.directionWC,
			run.appliedDirection,
			EXTERNAL_TURN,
			0
		);
		if (moved || turned || !this.allowed()) {
			this.halt(run);
			return;
		}

		const now = performance.now();
		const last = run.lastFrameAt;
		run.lastFrameAt = document.visibilityState === 'hidden' ? undefined : now;
		if (last === undefined || run.lastFrameAt === undefined) {
			return;
		}

		const elapsed = Math.min((now - last) / 1000, MAX_FRAME_SECONDS);
		// Negative: the camera drifts west, so the surface passes beneath it the way the Earth turns.
		const angle = (-2 * Math.PI * elapsed) / run.periodSeconds;
		Matrix3.fromRotationZ(angle, this.rotation);
		Matrix3.multiplyByVector(this.rotation, camera.positionWC, this.scratchPosition);
		Matrix3.multiplyByVector(this.rotation, camera.directionWC, this.scratchDirection);
		Matrix3.multiplyByVector(this.rotation, camera.upWC, this.scratchUp);
		camera.setView({
			destination: this.scratchPosition,
			orientation: { direction: this.scratchDirection, up: this.scratchUp },
			endTransform: Matrix4.IDENTITY
		});
		Cartesian3.clone(camera.positionWC, run.applied);
		Cartesian3.clone(camera.directionWC, run.appliedDirection);
	}
}
