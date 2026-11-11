import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import type { CameraOutcome } from './globe/choreography';
import type { GlobeScene } from './globe/GlobeScene';
import { MissingIonTokenError, requireIonToken } from './globe/ionToken';
import type { ResetResult } from './globe/mountainCamera';
import type { StageSize } from './globe/stageFrame';
import type { ZoomDirection, ZoomResult } from './globe/zoomStep';
import { startScene } from './lifecycle';
import { releaseBestEffort } from './releaseBestEffort';
import { INITIALIZATION_FAILED_STATE } from './sceneState';
import type { SceneStore } from './SceneStore';

export type PresentationOutcome = CameraOutcome['status'];

// What the session tells whoever coordinates experiences around it. Only the presentation that is
// still current is reported, so a superseded one never reaches the observer.
export interface PresentationObserver {
	presenting(target: SceneTarget): void;
	presented(target: SceneTarget, outcome: PresentationOutcome): void;
	/** The session will present nothing further: it stopped, or it has no scene to present with. */
	ended(): void;
}

export interface SceneSessionOptions {
	ionToken: string | undefined;
	createScene: (ionToken: string, signal: AbortSignal) => Promise<GlobeScene>;
	store: SceneStore;
	onError?: (error: unknown) => void;
	observer?: PresentationObserver;
}

const noop = () => {};

// The constructor starts the session; `stop()` is its only teardown and is idempotent.
export class SceneSession {
	private readonly store: SceneStore;
	private readonly onError: ((error: unknown) => void) | undefined;
	private readonly observer: PresentationObserver | undefined;
	private scene: GlobeScene | undefined;
	private releaseOrientation: () => void = noop;
	private releaseScale: () => void = noop;
	private releaseImagery: () => void = noop;
	private stopScene: () => void = noop;
	private imageryDegraded = false;
	private settled = false;
	private target: SceneTarget | undefined;
	private stage: StageSize | undefined;
	private stopped = false;
	private revealed = false;
	private presentation = 0;

	constructor({ ionToken, createScene, store, onError, observer }: SceneSessionOptions) {
		this.store = store;
		this.onError = onError;
		this.observer = observer;

		let token: string;
		try {
			token = requireIonToken(ionToken);
		} catch (error) {
			if (!(error instanceof MissingIonTokenError)) {
				throw error;
			}
			store.setState({ status: 'failed', failure: 'missing-token', message: error.message });
			return;
		}

		store.setState({ status: 'loading' });
		this.stopScene = startScene(
			async (signal) => createScene(token, signal),
			(error) => {
				this.reportInitializationFailure(error);
				this.observer?.ended();
			},
			(ready) => this.attach(ready)
		);
	}

	setTarget(next: SceneTarget | undefined): void {
		if (this.stopped) {
			return;
		}
		this.target = next;
		if (this.scene && next) {
			this.begin(next);
			return;
		}
		if (next && this.store.getSnapshot().state.status === 'failed') {
			this.observer?.ended();
		}
	}

	updateStage(size: StageSize): void {
		if (this.stopped) {
			return;
		}
		this.stage = size;
		this.scene?.updateStage(size);
	}

	resetView(): ResetResult {
		return this.scene && this.settled ? this.scene.resetView() : 'unavailable';
	}

	// Gated like Reset: an explicit step must not fight the reveal or a flight between mountains.
	zoomView(direction: ZoomDirection): ZoomResult {
		return this.scene && this.settled ? this.scene.zoomView(direction) : 'unavailable';
	}

	// Only a pose the current target arrived at is a pose someone chose to look at.
	readCamera(): CameraReading | undefined {
		return this.scene && this.settled ? this.scene.readCamera() : undefined;
	}

	stop(): void {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.presentation += 1;
		this.publishSettled(false);
		this.store.setOrientation(undefined);
		this.store.setScale(undefined);
		this.scene = undefined;
		this.observer?.ended();

		const { releaseOrientation, releaseScale, releaseImagery, stopScene } = this;
		this.releaseOrientation = noop;
		this.releaseScale = noop;
		this.releaseImagery = noop;
		this.stopScene = noop;

		// The scene goes last: a retry must never meet a live Viewer because a release threw.
		releaseBestEffort('Scene session', [
			['orientation subscription', releaseOrientation],
			['scale subscription', releaseScale],
			['imagery subscription', releaseImagery],
			['scene', stopScene]
		]);
	}

	// A throw while wiring a scene that exists must still end in the failed state; stop() releases
	// whatever was wired and destroys the scene, so a retry never meets a second live Viewer.
	private failSetup(error: unknown): void {
		if (this.stopped) {
			return;
		}
		this.stop();
		this.reportInitializationFailure(error);
	}

	private reportInitializationFailure(error: unknown): void {
		this.onError?.(error);
		this.store.setState(INITIALIZATION_FAILED_STATE);
	}

	private attach(ready: GlobeScene): void {
		try {
			this.wire(ready);
		} catch (error) {
			this.failSetup(error);
		}
	}

	private wire(ready: GlobeScene): void {
		this.scene = ready;
		this.releaseOrientation = ready.subscribeOrientation((orientation) => {
			if (!this.stopped) {
				this.store.setOrientation(orientation);
			}
		});
		this.releaseScale = ready.subscribeScale((reading) => {
			if (!this.stopped) {
				this.store.setScale(reading);
			}
		});
		this.releaseImagery = ready.subscribeImageryHealth((degraded) => {
			if (this.stopped || degraded === this.imageryDegraded) {
				return;
			}
			this.imageryDegraded = degraded;
			if (this.revealed) {
				this.publishReady();
			}
		});

		if (this.stage) {
			ready.updateStage(this.stage);
		}
		if (this.target) {
			this.begin(this.target);
			return;
		}
		this.revealed = true;
		this.publishReady();
	}

	private publishReady(): void {
		this.store.setState(
			this.imageryDegraded ? { status: 'ready', imageryDegraded: true } : { status: 'ready' }
		);
	}

	private publishSettled(next: boolean): void {
		if (next === this.settled) {
			return;
		}
		this.settled = next;
		this.store.setSettled(next);
	}

	private publishCamera(target: SceneTarget, outcome: CameraOutcome): void {
		this.publishSettled(outcome.status === 'arrived');
		this.observer?.presented(target, outcome.status);
	}

	private begin(next: SceneTarget): void {
		const ticket = ++this.presentation;
		this.publishSettled(false);
		this.observer?.presenting(next);
		if (!this.revealed) {
			void this.presentInitial(next, ticket);
			return;
		}
		void this.presentNext(next, ticket);
	}

	private isCurrent(ticket: number): boolean {
		return !this.stopped && ticket === this.presentation;
	}

	private async presentInitial(next: SceneTarget, ticket: number): Promise<void> {
		const ready = this.scene;
		if (!ready) {
			return;
		}
		let cinematic: boolean;
		try {
			cinematic = ready.prepareReveal(next);
		} catch (error) {
			this.failSetup(error);
			return;
		}
		if (cinematic) {
			await this.revealGlobeThenApproach(ready, next, ticket);
			return;
		}
		await this.revealPlacedMountain(ready, next, ticket);
	}

	private async revealGlobeThenApproach(
		ready: GlobeScene,
		next: SceneTarget,
		ticket: number
	): Promise<void> {
		await ready.whenViewReady().catch(() => undefined);
		if (!this.isCurrent(ticket)) {
			return;
		}
		this.revealed = true;
		this.publishReady();
		try {
			const outcome = await ready.showMountain(next, 'initial');
			if (this.isCurrent(ticket)) {
				this.publishCamera(next, outcome);
			}
		} catch (error) {
			if (this.isCurrent(ticket)) {
				this.publishCamera(next, { status: 'failed', error });
			}
		}
	}

	private async revealPlacedMountain(
		ready: GlobeScene,
		next: SceneTarget,
		ticket: number
	): Promise<void> {
		try {
			const outcome = await ready.showMountain(next, 'initial');
			if (!this.isCurrent(ticket)) {
				return;
			}
			this.publishCamera(next, outcome);
			await ready.whenViewReady();
		} catch (error) {
			if (!this.isCurrent(ticket)) {
				return;
			}
			this.publishCamera(next, { status: 'failed', error });
			await ready.whenViewReady().catch(() => undefined);
		}
		if (!this.isCurrent(ticket)) {
			return;
		}
		this.revealed = true;
		this.publishReady();
	}

	private async presentNext(next: SceneTarget, ticket: number): Promise<void> {
		const ready = this.scene;
		if (!ready) {
			return;
		}
		try {
			const outcome = await ready.showMountain(next, 'next');
			if (this.isCurrent(ticket)) {
				this.publishCamera(next, outcome);
			}
		} catch (error) {
			if (this.isCurrent(ticket)) {
				this.publishCamera(next, { status: 'failed', error });
			}
		}
	}
}
