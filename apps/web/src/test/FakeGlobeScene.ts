import type { AtlasMarker } from '../stage/globe/atlasMarkers';
import type { SceneTarget } from '../stage/globe/camera';
import type { CameraReading } from '../stage/globe/cameraReading';
import type { CameraOutcome } from '../stage/globe/choreography';
import type { LookState } from '../stage/globe/glidePath';
import type { GlobeScene, RefitResult } from '../stage/globe/GlobeScene';
import type { MarkerActivation } from '../stage/globe/markerActivation';
import type { MountainPlacement, ResetResult } from '../stage/globe/mountainCamera';
import type { ViewOrientation } from '../stage/globe/orientation';
import type { ScaleReading } from '../stage/globe/scaleBar';
import type { StageSize } from '../stage/globe/stageFrame';
import type { ZoomDirection, ZoomResult } from '../stage/globe/zoomStep';

export interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
	reject(reason: unknown): void;
}

export function createDeferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

export interface PendingShow {
	target: SceneTarget;
	placement: MountainPlacement;
	resolve(outcome: CameraOutcome): void;
	reject(reason: unknown): void;
}

export type FakeSetupStep =
	| 'prepareReveal'
	| 'updateStage'
	| 'subscribeOrientation'
	| 'subscribeScale'
	| 'subscribeImageryHealth';

export type FakeReleaseStep = 'orientation' | 'scale' | 'imagery';

export interface FakeGlobeSceneOptions {
	throwOn?: Partial<Record<FakeSetupStep, Error>>;
	throwOnRelease?: Partial<Record<FakeReleaseStep, Error>>;
	cinematic?: boolean;
	holdShow?: boolean;
	holdViewReady?: boolean;
	reducedMotion?: boolean;
	onDestroy?: () => void;
}

class ReplaceableSubscription<T> {
	private current: { listener: (value: T | undefined) => void; heard: boolean } | undefined;

	constructor(private readonly isDestroyed: () => boolean) {}

	get live(): boolean {
		return this.current !== undefined;
	}

	subscribe(listener: (value: T | undefined) => void): () => void {
		this.end();
		if (this.isDestroyed()) {
			listener(undefined);
			return () => {};
		}
		const subscription = { listener, heard: false };
		this.current = subscription;
		return () => {
			if (this.current === subscription) {
				this.end();
			}
		};
	}

	emit(value: T | undefined): void {
		if (!this.current) {
			return;
		}
		this.current.heard = value !== undefined;
		this.current.listener(value);
	}

	end(): void {
		const subscription = this.current;
		this.current = undefined;
		if (subscription?.heard) {
			subscription.listener(undefined);
		}
	}
}

export class FakeGlobeScene implements GlobeScene {
	readonly prepared: SceneTarget[] = [];
	readonly shown: { target: SceneTarget; placement: MountainPlacement }[] = [];
	readonly stages: StageSize[] = [];
	readonly pendingShows: PendingShow[] = [];
	readonly overviews: { look: LookState; animate: boolean }[] = [];
	readonly pendingOverviews: ((outcome: CameraOutcome) => void)[] = [];
	clears = 0;
	/** Every range the scene was asked to refit to, in order. */
	readonly refits: number[] = [];
	refitResult: RefitResult = 'refitted';
	resetResult: ResetResult = 'reset';
	zoomResult: ZoomResult = 'zoomed';
	readonly zooms: ZoomDirection[] = [];
	reading: CameraReading | undefined;
	reads = 0;
	resets = 0;
	destroyCount = 0;
	cinematic: boolean;
	holdShow: boolean;
	holdViewReady: boolean;
	reducedMotion: boolean;
	/** Every marker set handed to the scene, in order; `undefined` took the markers away. */
	readonly markerSets: (readonly AtlasMarker[] | undefined)[] = [];
	/** Every orbit started, with whether it is still turning. */
	readonly orbits: { periodSeconds: number; running: boolean; onHalted: () => void }[] = [];

	private readonly onDestroy: (() => void) | undefined;
	private readonly throwOn: Partial<Record<FakeSetupStep, Error>>;
	private readonly throwOnRelease: Partial<Record<FakeReleaseStep, Error>>;
	private readonly viewWaiters: Deferred<void>[] = [];
	private readonly orientation = new ReplaceableSubscription<ViewOrientation>(() => this.destroyed);
	private readonly scale = new ReplaceableSubscription<ScaleReading>(() => this.destroyed);
	private readonly imagery = new Set<(degraded: boolean) => void>();
	private interaction: (() => void) | undefined;
	private activation: ((activation: MarkerActivation) => void) | undefined;
	private degraded = false;

	constructor({
		throwOn = {},
		throwOnRelease = {},
		cinematic = false,
		holdShow = false,
		holdViewReady = false,
		reducedMotion = false,
		onDestroy
	}: FakeGlobeSceneOptions = {}) {
		this.reducedMotion = reducedMotion;
		this.cinematic = cinematic;
		this.holdShow = holdShow;
		this.holdViewReady = holdViewReady;
		this.onDestroy = onDestroy;
		this.throwOn = throwOn;
		this.throwOnRelease = throwOnRelease;
	}

	// The subscription ends first, as a real release that fails halfway would leave it.
	private failingRelease(step: FakeReleaseStep, release: () => void): () => void {
		const error = this.throwOnRelease[step];
		if (!error) {
			return release;
		}
		return () => {
			release();
			throw error;
		};
	}

	private failIfRequested(step: FakeSetupStep): void {
		const error = this.throwOn[step];
		if (error) {
			throw error;
		}
	}

	get destroyed(): boolean {
		return this.destroyCount > 0;
	}

	get liveSubscriptions(): number {
		return (
			Number(this.orientation.live) +
			Number(this.scale.live) +
			this.imagery.size +
			Number(this.interaction !== undefined) +
			Number(this.activation !== undefined)
		);
	}

	get orbiting(): boolean {
		return this.orbits.some((orbit) => orbit.running);
	}

	prepareReveal(target: SceneTarget): boolean {
		this.failIfRequested('prepareReveal');
		this.prepared.push(target);
		return !this.destroyed && this.cinematic;
	}

	showMountain(target: SceneTarget, placement: MountainPlacement): Promise<CameraOutcome> {
		this.stopOrbit();
		this.shown.push({ target, placement });
		if (this.destroyed) {
			return Promise.resolve({ status: 'interrupted' });
		}
		if (!this.holdShow) {
			return Promise.resolve({ status: 'arrived' });
		}
		return new Promise((resolve, reject) => {
			this.pendingShows.push({ target, placement, resolve, reject });
		});
	}

	// A clear interrupts every show still in flight, as the real camera's ticket does.
	clearTarget(): void {
		if (this.destroyed) {
			return;
		}
		this.clears += 1;
		this.interruptPending();
	}

	showOverview(look: LookState, animate: boolean): Promise<CameraOutcome> {
		if (this.destroyed) {
			return Promise.resolve({ status: 'interrupted' });
		}
		this.stopOrbit();
		this.clearTarget();
		this.overviews.push({ look, animate });
		if (!animate || !this.holdShow) {
			return Promise.resolve({ status: 'arrived' });
		}
		return new Promise((resolve) => {
			this.pendingOverviews.push(resolve);
		});
	}

	refitRange(rangeMeters: number): RefitResult {
		if (this.destroyed) {
			return 'unavailable';
		}
		this.refits.push(rangeMeters);
		return this.refitResult;
	}

	canOrbit(): boolean {
		return !this.destroyed && !this.reducedMotion;
	}

	startOrbit(periodSeconds: number, onHalted: () => void): boolean {
		this.stopOrbit();
		if (!this.canOrbit()) {
			return false;
		}
		this.orbits.push({ periodSeconds, running: true, onHalted });
		return true;
	}

	stopOrbit(): void {
		for (const orbit of this.orbits) {
			orbit.running = false;
		}
	}

	/** The orbit ends by itself, as when something else moves the camera. */
	haltOrbit(): void {
		const running = this.orbits.find((orbit) => orbit.running);
		if (running) {
			running.running = false;
			running.onHalted();
		}
	}

	setAtlasMarkers(markers: readonly AtlasMarker[] | undefined): void {
		if (!this.destroyed) {
			this.markerSets.push(markers);
		}
	}

	/** The markers the scene draws now. */
	get atlasMarkers(): readonly AtlasMarker[] | undefined {
		return this.markerSets.at(-1);
	}

	subscribeInteraction(listener: () => void): () => void {
		if (this.destroyed) {
			return () => {};
		}
		this.interaction = listener;
		return () => {
			if (this.interaction === listener) {
				this.interaction = undefined;
			}
		};
	}

	subscribeMarkerActivation(listener: (activation: MarkerActivation) => void): () => void {
		if (this.destroyed) {
			return () => {};
		}
		this.activation = listener;
		return () => {
			if (this.activation === listener) {
				this.activation = undefined;
			}
		};
	}

	/** A click or tap that reached drawn markers. */
	activate(activation: MarkerActivation): void {
		this.activation?.(activation);
	}

	/** A press or a wheel on the globe. */
	interact(): void {
		this.interaction?.();
	}

	whenViewReady(): Promise<void> {
		if (this.destroyed || !this.holdViewReady) {
			return Promise.resolve();
		}
		for (const waiter of this.viewWaiters.splice(0)) {
			waiter.resolve();
		}
		const waiter = createDeferred<void>();
		this.viewWaiters.push(waiter);
		return waiter.promise;
	}

	updateStage(size: StageSize): void {
		this.failIfRequested('updateStage');
		if (!this.destroyed) {
			this.stages.push(size);
		}
	}

	resetView(): ResetResult {
		if (this.destroyed) {
			return 'unavailable';
		}
		this.stopOrbit();
		this.resets += 1;
		return this.resetResult;
	}

	zoomView(direction: ZoomDirection): ZoomResult {
		if (this.destroyed) {
			return 'unavailable';
		}
		this.stopOrbit();
		this.zooms.push(direction);
		return this.zoomResult;
	}

	readCamera(): CameraReading | undefined {
		this.reads += 1;
		return this.destroyed ? undefined : this.reading;
	}

	subscribeOrientation(listener: (orientation: ViewOrientation | undefined) => void): () => void {
		this.failIfRequested('subscribeOrientation');
		return this.failingRelease('orientation', this.orientation.subscribe(listener));
	}

	subscribeScale(listener: (reading: ScaleReading | undefined) => void): () => void {
		this.failIfRequested('subscribeScale');
		return this.failingRelease('scale', this.scale.subscribe(listener));
	}

	subscribeImageryHealth(listener: (degraded: boolean) => void): () => void {
		this.failIfRequested('subscribeImageryHealth');
		if (this.destroyed) {
			return () => {};
		}
		this.imagery.add(listener);
		if (this.degraded) {
			listener(true);
		}
		return this.failingRelease('imagery', () => {
			this.imagery.delete(listener);
		});
	}

	destroy(): void {
		this.destroyCount += 1;
		if (this.destroyCount > 1) {
			return;
		}
		this.orientation.end();
		this.scale.end();
		this.imagery.clear();
		this.interaction = undefined;
		this.activation = undefined;
		this.stopOrbit();
		for (const waiter of this.viewWaiters.splice(0)) {
			waiter.resolve();
		}
		this.interruptPending();
		this.onDestroy?.();
	}

	private interruptPending(): void {
		for (const pending of this.pendingShows.splice(0)) {
			pending.resolve({ status: 'interrupted' });
		}
		for (const resolve of this.pendingOverviews.splice(0)) {
			resolve({ status: 'interrupted' });
		}
	}

	emitOrientation(viewHeadingDegrees: number | undefined): void {
		this.orientation.emit(viewHeadingDegrees === undefined ? undefined : { viewHeadingDegrees });
	}

	emitScale(reading: ScaleReading | undefined): void {
		this.scale.emit(reading);
	}

	setImageryDegraded(degraded: boolean): void {
		if (this.destroyed || degraded === this.degraded) {
			return;
		}
		this.degraded = degraded;
		for (const listener of [...this.imagery]) {
			listener(degraded);
		}
	}

	arriveViewReady(): void {
		for (const waiter of this.viewWaiters.splice(0)) {
			waiter.resolve();
		}
	}
}
