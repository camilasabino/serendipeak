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

export interface FlightCallbacks {
	onComplete: () => void;
	onCancel: () => void;
}

export interface CameraFlight {
	fly(move: CameraMove, callbacks: FlightCallbacks): void;
	glide(glide: CameraGlide, callbacks: GlideCallbacks): void;
	jump(target: SceneTarget, offset: CesiumCameraOffset): void;
	/** Places a free look at once; false when the current view cannot express it. */
	applyLook(look: LookState): boolean;
	/** Flies to a free look; false, without moving, when the current view cannot express it. */
	flyToLook(look: LookState, durationSeconds: number, callbacks: FlightCallbacks): boolean;
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
	kind: 'travel' | 'reframe' | 'view';
	/** Undefined for a free look, which presents no mountain. */
	target: SceneTarget | undefined;
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
		if (this.run?.target && isSameTarget(this.run.target, target)) {
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

	/**
	 * Moves the camera to a look that presents no mountain, such as a whole-globe overview. Any run
	 * is cancelled and the summit marker hidden, since the camera no longer shows a target. A zero
	 * duration places the look at once.
	 */
	view(
		look: LookState,
		durationSeconds: number,
		onSettled?: (outcome: CameraOutcome) => void
	): void {
		if (this.stopped) {
			onSettled?.({ status: 'interrupted' });
			return;
		}

		this.release();
		if (!(durationSeconds > 0)) {
			onSettled?.(this.applyLook(look));
			return;
		}

		let active = true;
		this.run = {
			kind: 'view',
			target: undefined,
			listen() {},
			cancel: () => {
				if (!active) {
					return;
				}
				active = false;
				this.flight.cancel();
				onSettled?.({ status: 'interrupted' });
			}
		};
		const finish = (outcome: CameraOutcome) => {
			if (!active) {
				return;
			}
			active = false;
			this.run = undefined;
			onSettled?.(outcome);
		};

		let started: boolean;
		try {
			started = this.flight.flyToLook(look, durationSeconds, {
				onComplete: () => finish({ status: 'arrived' }),
				onCancel: () => finish({ status: 'interrupted' })
			});
		} catch (error) {
			finish({ status: 'failed', error });
			return;
		}
		if (!started) {
			finish({ status: 'failed', error: new Error('The view cannot express this look.') });
		}
	}

	/**
	 * Lets go of the presented mountain without ending the director: the run stops where it is,
	 * the summit marker goes and nothing counts as settled, but later commands still work.
	 */
	release(): void {
		this.cancelRun();
		this.settled = undefined;
		this.markers.hide();
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

	private applyLook(look: LookState): CameraOutcome {
		try {
			return this.flight.applyLook(look)
				? { status: 'arrived' }
				: { status: 'failed', error: new Error('The view cannot express this look.') };
		} catch (error) {
			return { status: 'failed', error };
		}
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
