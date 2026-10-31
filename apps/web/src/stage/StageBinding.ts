import type { SceneTarget } from './globe/camera';
import type { ResetResult } from './globe/mountainCamera';
import type { StageSize } from './globe/stageFrame';
import { SceneSession, type SceneSessionOptions } from './SceneSession';
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
}

function reportInitializationFailure(error: unknown): void {
	console.error('Cesium viewer failed to initialize', error);
}

export class StageBinding {
	private readonly session: SceneSession;
	private readonly observer: ResizeObserver;
	private published: StageSize | undefined;
	private disposed = false;

	constructor(private readonly options: StageBindingOptions) {
		const { viewport, store, ionToken, createScene, target, onError } = options;

		this.session = new SceneSession({
			ionToken,
			createScene,
			store,
			onError: onError ?? reportInitializationFailure
		});
		const { state } = store.getSnapshot();
		if (state.status === 'failed' && state.failure === 'missing-token') {
			console.error(state.message);
		}

		this.publishSize();
		this.session.setTarget(target);

		this.observer = new ResizeObserver(() => this.publishSize());
		this.observer.observe(viewport);
	}

	setTarget(target: SceneTarget | undefined): void {
		if (!this.disposed) {
			this.session.setTarget(target);
		}
	}

	resetView(): ResetResult {
		return this.disposed ? 'unavailable' : this.session.resetView();
	}

	dispose(): void {
		if (this.disposed) {
			return;
		}
		this.disposed = true;
		this.observer.disconnect();
		this.session.stop();
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
