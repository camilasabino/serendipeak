import type { SceneTarget } from '../stage/globe/camera';
import type { CameraReading } from '../stage/globe/cameraReading';
import type { CameraOutcome } from '../stage/globe/choreography';
import type { GlobeScene } from '../stage/globe/GlobeScene';
import type { MountainPlacement, ResetResult } from '../stage/globe/mountainCamera';
import type { ViewOrientation } from '../stage/globe/orientation';
import type { ScaleReading } from '../stage/globe/scaleBar';
import type { StageSize } from '../stage/globe/stageFrame';

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
	resetResult: ResetResult = 'reset';
	reading: CameraReading | undefined;
	reads = 0;
	resets = 0;
	destroyCount = 0;
	cinematic: boolean;
	holdShow: boolean;
	holdViewReady: boolean;

	private readonly onDestroy: (() => void) | undefined;
	private readonly throwOn: Partial<Record<FakeSetupStep, Error>>;
	private readonly throwOnRelease: Partial<Record<FakeReleaseStep, Error>>;
	private readonly viewWaiters: Deferred<void>[] = [];
	private readonly orientation = new ReplaceableSubscription<ViewOrientation>(() => this.destroyed);
	private readonly scale = new ReplaceableSubscription<ScaleReading>(() => this.destroyed);
	private readonly imagery = new Set<(degraded: boolean) => void>();
	private degraded = false;

	constructor({
		throwOn = {},
		throwOnRelease = {},
		cinematic = false,
		holdShow = false,
		holdViewReady = false,
		onDestroy
	}: FakeGlobeSceneOptions = {}) {
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
		return Number(this.orientation.live) + Number(this.scale.live) + this.imagery.size;
	}

	prepareReveal(target: SceneTarget): boolean {
		this.failIfRequested('prepareReveal');
		this.prepared.push(target);
		return !this.destroyed && this.cinematic;
	}

	showMountain(target: SceneTarget, placement: MountainPlacement): Promise<CameraOutcome> {
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
		this.resets += 1;
		return this.resetResult;
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
		for (const waiter of this.viewWaiters.splice(0)) {
			waiter.resolve();
		}
		for (const pending of this.pendingShows.splice(0)) {
			pending.resolve({ status: 'interrupted' });
		}
		this.onDestroy?.();
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
