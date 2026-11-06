import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import type { ResetResult } from './globe/mountainCamera';
import type { StageSize } from './globe/stageFrame';
import { SceneSession, type PresentationObserver, type SceneSessionOptions } from './SceneSession';
import { sceneCanRetry } from './experience';
import type { SceneStore } from './SceneStore';

export interface StageElements {
	viewport: HTMLElement;
}

export type CreateScene = SceneSessionOptions['createScene'];

export type SceneFactory = (elements: StageElements) => CreateScene;

export interface StageBindingOptions {
	viewport: HTMLElement;
	store: SceneStore;
	ionToken: string | undefined;
	createScene: CreateScene;
	target: SceneTarget | undefined;
	onError?: (error: unknown) => void;
	observer?: PresentationObserver;
}

function reportInitializationFailure(error: unknown): void {
	console.error('Cesium viewer failed to initialize', error);
}

export class StageBinding {
	private session: SceneSession;
	private readonly observer: ResizeObserver;
	private target: SceneTarget | undefined;
	private published: StageSize | undefined;
	private disposed = false;

	constructor(private readonly options: StageBindingOptions) {
		this.target = options.target;
		this.session = this.openSession();
		this.present();

		this.observer = new ResizeObserver(() => this.publishSize());
		this.observer.observe(options.viewport);
	}

	setTarget(target: SceneTarget | undefined): void {
		if (this.disposed) {
			return;
		}
		this.target = target;
		this.session.setTarget(target);
	}

	resetView(): ResetResult {
		return this.disposed ? 'unavailable' : this.session.resetView();
	}

	readCamera(): CameraReading | undefined {
		return this.disposed ? undefined : this.session.readCamera();
	}

	// The failed session is stopped before its replacement exists, so one binding never owns two.
	retry(): void {
		if (this.disposed || !sceneCanRetry(this.options.store.getSnapshot().state)) {
			return;
		}
		this.session.stop();
		this.session = this.openSession();
		this.present();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.observer.disconnect();
		this.session.stop();
	}

	private openSession(): SceneSession {
		const { store, ionToken, createScene, onError, observer } = this.options;
		const session = new SceneSession({
			ionToken,
			createScene,
			store,
			onError: onError ?? reportInitializationFailure,
			observer
		});
		const { state } = store.getSnapshot();
		if (state.status === 'failed' && state.failure === 'missing-token') {
			console.error(state.message);
		}

		return session;
	}

	private present(): void {
		this.published = undefined;
		this.publishSize();
		this.session.setTarget(this.target);
	}

	private publishSize(): void {
		if (this.disposed) {
			return;
		}

		const { clientWidth: width, clientHeight: height } = this.options.viewport;
		if (this.published?.width === width && this.published.height === height) {
			return;
		}
		this.published = { width, height };
		this.session.updateStage(this.published);
	}
}
