import type { SceneTarget } from './camera';
import type { GlidePlan, LookState, TransitionJourney } from './glidePath';
import { planSummitMarker, type SummitMarkerDisplay } from './marker';
import type { CesiumCameraOffset } from './terrainCamera';
import { planExploreTransition, planFreshApproach, type MotionPreference } from './transitionPlan';

export const DIRECT_FLIGHT_SECONDS = 2;
export const RESET_FLIGHT_SECONDS = 1.2;
export const FLIGHT_HEIGHT_CAP_METERS = 1_000_000;

export type CameraOutcome =
	{ status: 'arrived' } | { status: 'interrupted' } | { status: 'failed'; error: unknown };

export interface CameraMove {
	target: SceneTarget;
	offset: CesiumCameraOffset;
	durationSeconds: number;
	maximumHeightMeters: number;
}

export interface CameraGlide {
	target: SceneTarget;
	offset: CesiumCameraOffset;
	plan: GlidePlan;
}

export interface GlideCallbacks {
	onApproach: () => void;
	onComplete: () => void;
	onCancel: () => void;
	onFail: (error: unknown) => void;
}

export interface CameraFlight {
	fly(move: CameraMove, callbacks: { onComplete: () => void; onCancel: () => void }): void;
	glide(glide: CameraGlide, callbacks: GlideCallbacks): void;
	jump(target: SceneTarget, offset: CesiumCameraOffset): void;
	look(): LookState | undefined;
	cancel(): void;
}

export interface CameraDirectorOptions {
	cameraHeight?: () => number;
	motion?: () => MotionPreference;
}

export interface ReframeOptions {
	supersede?: boolean;
	durationSeconds?: number;
}

function isSameCamera(a: SceneTarget['camera'], b: SceneTarget['camera']): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}
	return (
		a.headingDegrees === b.headingDegrees &&
		a.pitchDegrees === b.pitchDegrees &&
		a.rangeMeters === b.rangeMeters &&
		(a.framing?.x ?? 0) === (b.framing?.x ?? 0) &&
		(a.framing?.y ?? 0) === (b.framing?.y ?? 0)
	);
}

function isSameTarget(a: SceneTarget, b: SceneTarget): boolean {
	return (
		a.slug === b.slug &&
		a.name === b.name &&
		a.latitude === b.latitude &&
		a.longitude === b.longitude &&
		a.elevationMeters === b.elevationMeters &&
		isSameCamera(a.camera, b.camera)
	);
}

function flightMove(
	target: SceneTarget,
	offset: CesiumCameraOffset,
	cameraHeight: () => number,
	durationSeconds: number
): CameraMove {
	return {
		target,
		offset,
		durationSeconds,
		maximumHeightMeters: Math.min(cameraHeight(), FLIGHT_HEIGHT_CAP_METERS)
	};
}

export function lookFromOffset(target: SceneTarget, offset: CesiumCameraOffset): LookState {
	return {
		latitude: target.latitude,
		longitude: target.longitude,
		altitudeMeters: target.elevationMeters,
		headingDegrees: (offset.headingRadians * 180) / Math.PI,
		pitchDegrees: (offset.pitchRadians * 180) / Math.PI,
		rangeMeters: offset.rangeMeters,
		framingX: offset.framingX,
		framingY: offset.framingY
	};
}

interface ActiveRun {
	kind: 'travel' | 'reframe';
	target: SceneTarget;
	cancel: () => void;
	listen: (onSettled?: (outcome: CameraOutcome) => void) => void;
}

export class CameraDirector {
	private readonly cameraHeight: () => number;
	private readonly motion: () => MotionPreference;
	private stopped = false;
	private settled: SceneTarget | undefined;
	private run: ActiveRun | undefined;

	constructor(
		private readonly flight: CameraFlight,
		private readonly markers: SummitMarkerDisplay,
		{ cameraHeight = () => 0, motion = () => 'full' }: CameraDirectorOptions = {}
	) {
		this.cameraHeight = cameraHeight;
		this.motion = motion;
	}

	place(
		target: SceneTarget,
		offset: CesiumCameraOffset,
		onSettled?: (outcome: CameraOutcome) => void
	): void {
		if (this.stopped) {
			onSettled?.({ status: 'interrupted' });
			return;
		}
		if (!this.run && this.settled && isSameTarget(this.settled, target)) {
			onSettled?.({ status: 'arrived' });
			return;
		}

		this.cancelRun();
		try {
			this.flight.jump(target, offset);
		} catch (error) {
			onSettled?.({ status: 'failed', error });
			return;
		}
		this.showMarker(target, onSettled);
	}

	travel(
		target: SceneTarget,
		offset: CesiumCameraOffset,
		journey: TransitionJourney,
		onSettled?: (outcome: CameraOutcome) => void
	): void {
		if (this.stopped) {
			onSettled?.({ status: 'interrupted' });
			return;
		}
		if (this.run && isSameTarget(this.run.target, target)) {
			this.run.listen(onSettled);
			return;
		}
		if (!this.run && this.settled && isSameTarget(this.settled, target)) {
			onSettled?.({ status: 'arrived' });
			return;
		}

		const destination = lookFromOffset(target, offset);
		const plan =
			journey === 'reveal'
				? planFreshApproach(destination, this.motion())
				: planExploreTransition(this.flight.look(), destination, this.motion());
		if (plan.mode === 'direct') {
			this.place(target, offset, onSettled);
			return;
		}

		this.cancelRun();
		this.markers.hide();
		this.settled = undefined;

		let active = true;
		let markerShown = false;
		const listeners: ((outcome: CameraOutcome) => void)[] = [];
		if (onSettled) {
			listeners.push(onSettled);
		}
		const notify = (outcome: CameraOutcome) => {
			for (const listener of listeners) {
				listener(outcome);
			}
		};
		const revealMarker = () => {
			if (markerShown) {
				return;
			}
			this.markers.show(planSummitMarker(target));
			markerShown = true;
		};
		this.run = {
			kind: 'travel',
			target,
			listen(next) {
				if (next) {
					listeners.push(next);
				}
			},
			cancel: () => {
				if (!active) {
					return;
				}
				active = false;
				this.flight.cancel();
				this.markers.hide();
				notify({ status: 'interrupted' });
			}
		};

		const finish = (outcome: CameraOutcome) => {
			if (!active) {
				return;
			}
			active = false;
			this.run = undefined;
			if (outcome.status === 'arrived') {
				try {
					revealMarker();
					this.settled = target;
					notify(outcome);
				} catch (error) {
					notify({ status: 'failed', error });
				}
				return;
			}
			this.markers.hide();
			notify(outcome);
		};

		try {
			this.flight.glide(
				{ target, offset, plan },
				{
					onApproach: () => {
						if (!active) {
							return;
						}
						try {
							revealMarker();
						} catch (error) {
							finish({ status: 'failed', error });
						}
					},
					onComplete: () => finish({ status: 'arrived' }),
					onCancel: () => finish({ status: 'interrupted' }),
					onFail: (error) => {
						if (!active) {
							return;
						}
						let failure = error;
						try {
							this.flight.jump(target, offset);
						} catch (recoveryError) {
							failure = new AggregateError([error, recoveryError], 'Camera glide failed');
						}
						finish({ status: 'failed', error: failure });
					}
				}
			);
		} catch (error) {
			finish({ status: 'failed', error });
		}
	}

	reframe(
		target: SceneTarget,
		offset: CesiumCameraOffset,
		animate: boolean,
		onSettled?: () => void,
		{ supersede = false, durationSeconds }: ReframeOptions = {}
	): boolean {
		if (this.stopped) {
			return false;
		}
		if (this.run) {
			if (!supersede || this.run.kind !== 'reframe') {
				return false;
			}
			this.cancelRun();
		}
		if (!animate) {
			try {
				this.flight.jump(target, offset);
			} catch {
				return false;
			}
			onSettled?.();
			return true;
		}

		let active = true;
		this.run = {
			kind: 'reframe',
			target,
			listen() {},
			cancel: () => {
				if (!active) {
					return;
				}
				active = false;
				this.flight.cancel();
			}
		};

		const finish = () => {
			if (!active) {
				return;
			}
			active = false;
			this.run = undefined;
			onSettled?.();
		};

		try {
			this.flight.fly(
				flightMove(target, offset, this.cameraHeight, durationSeconds ?? DIRECT_FLIGHT_SECONDS),
				{
					onComplete: finish,
					onCancel: () => {
						if (!active) {
							return;
						}
						active = false;
						this.run = undefined;
					}
				}
			);
		} catch {
			active = false;
			this.run = undefined;
			return false;
		}
		return true;
	}

	busy(): boolean {
		return this.run !== undefined;
	}

	stop(): void {
		this.stopped = true;
		this.cancelRun();
		this.settled = undefined;
		this.markers.hide();
	}

	private cancelRun(): void {
		const current = this.run;
		this.run = undefined;
		current?.cancel();
	}

	private showMarker(target: SceneTarget, onSettled?: (outcome: CameraOutcome) => void): void {
		try {
			this.markers.show(planSummitMarker(target));
			this.settled = target;
			onSettled?.({ status: 'arrived' });
		} catch (error) {
			onSettled?.({ status: 'failed', error });
		}
	}
}
