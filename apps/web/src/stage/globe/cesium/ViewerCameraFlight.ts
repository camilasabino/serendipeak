import type { BoundingSphere, Cartesian3, HeadingPitchRange, Viewer } from 'cesium';
import type { SceneTarget } from '../camera';
import type { CameraReading } from '../cameraReading';
import type { CameraFlight, CameraGlide, CameraMove, GlideCallbacks } from '../choreography';
import { cameraOffsetFromPose, cesiumVerticalFovRadians, lookAxesForFraming } from '../framing';
import { lookPose, sampleGlide, type LookState } from '../glidePath';
import type { StageSize } from '../stageFrame';
import { readSummitCamera, type CesiumCameraOffset } from '../terrainCamera';
import type { CesiumModule } from './CesiumModule';
import type { ViewSampler } from './ViewSampler';

const RESET_INPUT_HOLD_MS = 1300;

interface ActiveGlide {
	cancel(): void;
}

export class ViewerCameraFlight implements CameraFlight {
	private anchor: Pick<LookState, 'latitude' | 'longitude' | 'altitudeMeters'> | undefined;
	private activeGlide: ActiveGlide | undefined;
	private inputHold: ReturnType<typeof setTimeout> | undefined;
	private readonly scratchFocus: Cartesian3;
	private readonly scratchEnu: InstanceType<CesiumModule['Matrix4']>;
	private readonly scratchPosition: Cartesian3;
	private readonly scratchLook: Cartesian3;
	private readonly scratchLookUp: Cartesian3;
	private readonly scratchAxis: Cartesian3;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer,
		private readonly sampler: ViewSampler,
		private readonly measureStage: () => StageSize
	) {
		this.scratchFocus = new cesium.Cartesian3();
		this.scratchEnu = new cesium.Matrix4();
		this.scratchPosition = new cesium.Cartesian3();
		this.scratchLook = new cesium.Cartesian3();
		this.scratchLookUp = new cesium.Cartesian3();
		this.scratchAxis = new cesium.Cartesian3();
	}

	fly(
		move: CameraMove,
		{ onComplete, onCancel }: { onComplete: () => void; onCancel: () => void }
	): void {
		const { Matrix4, EasingFunction } = this.cesium;
		const { camera } = this.viewer;

		this.anchorOn(move.target);
		const oriented = this.framedOrientation(move.target, move.offset);
		if (!oriented) {
			camera.flyToBoundingSphere(this.summitSphere(move.target), {
				duration: move.durationSeconds,
				easingFunction: EasingFunction.QUADRATIC_IN_OUT,
				offset: this.offsetRange(move.offset),
				maximumHeight: move.maximumHeightMeters,
				complete: onComplete,
				cancel: onCancel
			});
			return;
		}

		camera.flyTo({
			destination: this.framedDestination(move.target, move.offset),
			orientation: oriented,
			duration: move.durationSeconds,
			easingFunction: EasingFunction.QUADRATIC_IN_OUT,
			maximumHeight: move.maximumHeightMeters,
			complete: onComplete,
			cancel: onCancel,
			endTransform: Matrix4.IDENTITY
		});
	}

	glide(
		{ target, offset, plan }: CameraGlide,
		{ onApproach, onComplete, onCancel, onFail }: GlideCallbacks
	): void {
		const controller = this.viewer.scene.screenSpaceCameraController;
		const approachFraction = plan.phases[1].startFraction;
		let startedAt: number | undefined;
		let approached = false;
		let finished = false;
		let removeFrameListener = () => {};

		const end = () => {
			finished = true;
			removeFrameListener();
			if (this.activeGlide === handle) {
				this.activeGlide = undefined;
			}
			controller.enableInputs = true;
		};
		const handle: ActiveGlide = {
			cancel() {
				if (finished) {
					return;
				}
				end();
				onCancel();
			}
		};
		const fail = (error: unknown) => {
			if (finished) {
				return;
			}
			end();
			onFail(error);
		};

		this.activeGlide?.cancel();
		controller.enableInputs = false;
		this.activeGlide = handle;
		removeFrameListener = this.viewer.scene.preUpdate.addEventListener(() => {
			if (finished) {
				return;
			}
			try {
				const now = performance.now();
				startedAt ??= now;
				const fraction = (now - startedAt) / 1000 / plan.durationSeconds;
				if (fraction >= 1) {
					this.jump(target, offset);
					end();
					onComplete();
					return;
				}
				this.applyLook(sampleGlide(plan, fraction));
				if (!approached && fraction >= approachFraction) {
					approached = true;
					onApproach();
				}
			} catch (error) {
				fail(error);
			}
		});
	}

	jump(target: SceneTarget, offset: CesiumCameraOffset): void {
		this.viewer.camera.viewBoundingSphere(this.summitSphere(target), this.offsetRange(offset));
		const oriented = this.framedOrientation(target, offset);
		this.unlockCamera(oriented?.direction, oriented?.up);
		this.anchorOn(target);
	}

	look(): LookState | undefined {
		const view = this.summitView();
		if (!view) {
			return undefined;
		}
		const { reading, framing } = view;
		if (
			!Number.isFinite(reading.headingDegrees) ||
			!Number.isFinite(reading.pitchDegrees) ||
			!(reading.displayRangeMeters > 0)
		) {
			return undefined;
		}

		return {
			...view.anchor,
			headingDegrees: reading.headingDegrees,
			pitchDegrees: reading.pitchDegrees,
			rangeMeters: reading.displayRangeMeters,
			framingX: framing?.x ?? 0,
			framingY: framing?.y ?? 0
		};
	}

	cameraReading(): CameraReading | undefined {
		const view = this.summitView();
		if (!view) {
			return undefined;
		}
		const { reading, framing } = view;

		return {
			headingDegrees: reading.headingDegrees,
			pitchDegrees: reading.pitchDegrees,
			rangeMeters: reading.baseRangeMeters,
			...(framing ? { framing } : {}),
			displayRangeMeters: reading.displayRangeMeters,
			stage: this.measureStage()
		};
	}

	private summitView() {
		if (!this.anchor || this.viewer.isDestroyed()) {
			return undefined;
		}

		const { Cartesian3, Matrix4, Transforms } = this.cesium;
		const focus = Cartesian3.fromDegrees(
			this.anchor.longitude,
			this.anchor.latitude,
			this.anchor.altitudeMeters
		);
		const inverse = Matrix4.inverse(Transforms.eastNorthUpToFixedFrame(focus), new Matrix4());
		const offset = Matrix4.multiplyByPoint(
			inverse,
			this.viewer.camera.positionWC,
			new Cartesian3()
		);
		const size = this.measureStage();

		return {
			anchor: this.anchor,
			reading: readSummitCamera(offset.x, offset.y, offset.z, size.width, size.height),
			framing: this.sampler.projectFraming(focus)
		};
	}

	cancel(): void {
		this.activeGlide?.cancel();
		this.viewer.camera.cancelFlight();
	}

	applyLook(look: LookState): boolean {
		if (this.viewer.isDestroyed()) {
			return false;
		}

		const frustum = this.activeFrustum();
		if (!frustum) {
			return false;
		}

		const pose = lookPose(look, frustum.fovy, frustum.aspect);
		if (!pose) {
			return false;
		}

		const { Cartesian3, Matrix4, Transforms } = this.cesium;
		Cartesian3.fromDegrees(
			look.longitude,
			look.latitude,
			look.altitudeMeters,
			undefined,
			this.scratchFocus
		);
		const enu = Transforms.eastNorthUpToFixedFrame(this.scratchFocus, undefined, this.scratchEnu);
		const { cameraFromFocus, axes } = pose;
		Matrix4.multiplyByPoint(
			enu,
			Cartesian3.fromElements(
				cameraFromFocus.x,
				cameraFromFocus.y,
				cameraFromFocus.z,
				this.scratchAxis
			),
			this.scratchPosition
		);
		Matrix4.multiplyByPointAsVector(
			enu,
			Cartesian3.fromElements(
				axes.direction.x,
				axes.direction.y,
				axes.direction.z,
				this.scratchAxis
			),
			this.scratchLook
		);
		Matrix4.multiplyByPointAsVector(
			enu,
			Cartesian3.fromElements(axes.up.x, axes.up.y, axes.up.z, this.scratchAxis),
			this.scratchLookUp
		);
		Cartesian3.normalize(this.scratchLook, this.scratchLook);
		Cartesian3.normalize(this.scratchLookUp, this.scratchLookUp);

		this.viewer.camera.setView({
			destination: this.scratchPosition,
			orientation: { direction: this.scratchLook, up: this.scratchLookUp },
			endTransform: Matrix4.IDENTITY
		});
		this.anchor = {
			latitude: look.latitude,
			longitude: look.longitude,
			altitudeMeters: look.altitudeMeters
		};

		return true;
	}

	holdInputs(): void {
		const controller = this.viewer.scene.screenSpaceCameraController;

		this.releaseInputHold();
		controller.enableInputs = false;
		this.inputHold = setTimeout(() => {
			this.inputHold = undefined;
			if (!this.activeGlide && !this.viewer.isDestroyed()) {
				controller.enableInputs = true;
			}
		}, RESET_INPUT_HOLD_MS);
	}

	release(): void {
		this.releaseInputHold();
		this.activeGlide?.cancel();
	}

	private releaseInputHold(): void {
		clearTimeout(this.inputHold);
		this.inputHold = undefined;
	}

	private anchorOn(target: SceneTarget): void {
		this.anchor = {
			latitude: target.latitude,
			longitude: target.longitude,
			altitudeMeters: target.elevationMeters
		};
	}

	private summitFixed(target: SceneTarget): Cartesian3 {
		return this.cesium.Cartesian3.fromDegrees(
			target.longitude,
			target.latitude,
			target.elevationMeters
		);
	}

	private summitSphere(target: SceneTarget): BoundingSphere {
		return new this.cesium.BoundingSphere(this.summitFixed(target), 1);
	}

	private offsetRange(offset: CesiumCameraOffset): HeadingPitchRange {
		return new this.cesium.HeadingPitchRange(
			offset.headingRadians,
			offset.pitchRadians,
			offset.rangeMeters
		);
	}

	private activeFrustum(): { fovy: number; aspect: number } | undefined {
		const frustum = this.viewer.camera.frustum;
		if (!(frustum instanceof this.cesium.PerspectiveFrustum) || typeof frustum.fov !== 'number') {
			return undefined;
		}

		const size = this.measureStage();
		const aspect =
			typeof frustum.aspectRatio === 'number' && frustum.aspectRatio > 0
				? frustum.aspectRatio
				: size.width / size.height;
		if (!(aspect > 0)) {
			return undefined;
		}

		const fovy =
			typeof frustum.fovy === 'number' && Number.isFinite(frustum.fovy)
				? frustum.fovy
				: cesiumVerticalFovRadians(frustum.fov, aspect);
		if (!(fovy > 0) || !Number.isFinite(fovy)) {
			return undefined;
		}

		return { fovy, aspect };
	}

	private framedOrientation(
		target: SceneTarget,
		offset: CesiumCameraOffset
	): { direction: Cartesian3; up: Cartesian3 } | undefined {
		if (offset.framingX === 0 && offset.framingY === 0) {
			return undefined;
		}

		const frustum = this.activeFrustum();
		if (!frustum) {
			return undefined;
		}

		const local = this.localOffset(offset);
		const axes = lookAxesForFraming(
			local,
			{ x: offset.framingX, y: offset.framingY },
			frustum.fovy,
			frustum.aspect
		);
		if (!axes) {
			return undefined;
		}

		const { Cartesian3, Matrix4, Transforms } = this.cesium;
		const enu = Transforms.eastNorthUpToFixedFrame(this.summitFixed(target));
		const direction = Matrix4.multiplyByPointAsVector(
			enu,
			new Cartesian3(axes.direction.x, axes.direction.y, axes.direction.z),
			new Cartesian3()
		);
		const up = Matrix4.multiplyByPointAsVector(
			enu,
			new Cartesian3(axes.up.x, axes.up.y, axes.up.z),
			new Cartesian3()
		);
		Cartesian3.normalize(direction, direction);
		Cartesian3.normalize(up, up);

		return { direction, up };
	}

	private framedDestination(target: SceneTarget, offset: CesiumCameraOffset): Cartesian3 {
		const { Cartesian3, Matrix4, Transforms } = this.cesium;
		const local = this.localOffset(offset);

		return Matrix4.multiplyByPoint(
			Transforms.eastNorthUpToFixedFrame(this.summitFixed(target)),
			new Cartesian3(local.x, local.y, local.z),
			new Cartesian3()
		);
	}

	private localOffset(offset: CesiumCameraOffset) {
		return cameraOffsetFromPose(
			(offset.headingRadians * 180) / Math.PI,
			(offset.pitchRadians * 180) / Math.PI,
			offset.rangeMeters
		);
	}

	private unlockCamera(direction?: Cartesian3, up?: Cartesian3): void {
		const { Cartesian3, Matrix4 } = this.cesium;
		const { camera } = this.viewer;

		camera.setView({
			destination: Cartesian3.clone(camera.positionWC),
			orientation: {
				direction: direction ?? Cartesian3.clone(camera.directionWC),
				up: up ?? Cartesian3.clone(camera.upWC)
			},
			endTransform: Matrix4.IDENTITY
		});
	}
}
