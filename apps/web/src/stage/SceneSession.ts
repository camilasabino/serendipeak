import type { SceneTarget } from './globe/camera';
import type { CameraOutcome } from './globe/choreography';
import type { GlobeScene } from './globe/GlobeScene';
import { MissingIonTokenError, requireIonToken } from './globe/ionToken';
import type { ResetResult } from './globe/mountainCamera';
import type { StageSize } from './globe/stageFrame';
import { startScene } from './lifecycle';
import type { SceneStore } from './SceneStore';

export interface SceneSessionOptions {
	ionToken: string | undefined;
	createScene: (ionToken: string, signal: AbortSignal) => Promise<GlobeScene>;
	store: SceneStore;
	onError?: (error: unknown) => void;
}

const INITIALIZATION_FAILED_MESSAGE = 'The 3D globe could not be loaded.';

const noop = () => {};

// The constructor starts the session; `stop()` is its only teardown and is idempotent.
export class SceneSession {
	private readonly store: SceneStore;
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

	constructor({ ionToken, createScene, store, onError }: SceneSessionOptions) {
		this.store = store;

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
				onError?.(error);
				store.setState({
					status: 'failed',
					failure: 'initialization-failed',
					message: INITIALIZATION_FAILED_MESSAGE
				});
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

	stop(): void {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.presentation += 1;
		this.publishSettled(false);
		this.releaseOrientation();
		this.releaseOrientation = noop;
		this.releaseScale();
		this.releaseScale = noop;
		this.releaseImagery();
		this.releaseImagery = noop;
		this.store.setOrientation(undefined);
		this.store.setScale(undefined);
		this.scene = undefined;
		this.stopScene();
		this.stopScene = noop;
	}

	private attach(ready: GlobeScene): void {
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

	private publishCamera(outcome: CameraOutcome): void {
		this.publishSettled(outcome.status === 'arrived');
	}

	private begin(next: SceneTarget): void {
		const ticket = ++this.presentation;
		this.publishSettled(false);
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
		if (ready.prepareReveal(next)) {
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
				this.publishCamera(outcome);
			}
		} catch (error) {
			if (this.isCurrent(ticket)) {
				this.publishCamera({ status: 'failed', error });
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
			this.publishCamera(outcome);
			await ready.whenViewReady();
		} catch (error) {
			if (!this.isCurrent(ticket)) {
				return;
			}
			this.publishCamera({ status: 'failed', error });
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
				this.publishCamera(outcome);
			}
		} catch (error) {
			if (this.isCurrent(ticket)) {
				this.publishCamera({ status: 'failed', error });
			}
		}
	}
}
