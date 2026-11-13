import {
	ATLAS_ORBIT_PERIOD_SECONDS,
	atlasOverviewLook,
	overviewRangeMeters,
	type AtlasView
} from './globe/atlasView';
import type { AtlasMarker } from './globe/atlasMarkers';
import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import type { CameraOutcome } from './globe/choreography';
import type { GlobeScene } from './globe/GlobeScene';
import { MissingIonTokenError, requireIonToken } from './globe/ionToken';
import type { MarkerActivation } from './globe/markerActivation';
import type { ResetResult } from './globe/mountainCamera';
import { stageAspect, type StageSize } from './globe/stageFrame';
import type { ZoomDirection, ZoomResult } from './globe/zoomStep';
import { startScene } from './lifecycle';
import { releaseBestEffort } from './releaseBestEffort';
import { INITIALIZATION_FAILED_STATE } from './sceneState';
import type { RotationState, SceneStore } from './SceneStore';

export type PresentationOutcome = CameraOutcome['status'];

// What the session tells whoever coordinates experiences around it. Only the presentation that is
// still current is reported, so a superseded one never reaches the observer.
export interface PresentationObserver {
	presenting(target: SceneTarget): void;
	presented(target: SceneTarget, outcome: PresentationOutcome): void;
	/** The session let go of its target without presenting another: nothing pending will arrive. */
	cleared(): void;
	/** The session will present nothing further: it stopped, or it has no scene to present with. */
	ended(): void;
}

export interface SceneSessionOptions {
	ionToken: string | undefined;
	createScene: (ionToken: string, signal: AbortSignal) => Promise<GlobeScene>;
	store: SceneStore;
	onError?: (error: unknown) => void;
	observer?: PresentationObserver;
	/** Clicks and taps on atlas markers, heard only while markers are drawn. */
	onMarkerActivate?: (activation: MarkerActivation) => void;
}

const noop = () => {};

const FAILED_FLIGHT: CameraOutcome = { status: 'failed', error: undefined };

/**
 * Where the atlas camera stands relative to its overview: `arriving` while placed or flown there,
 * `idle` once there and untouched, which is when the ambient orbit may turn it, and `away` after
 * anything else moved it.
 */
type OverviewStage = 'away' | 'arriving' | 'idle';

// The constructor starts the session; `stop()` is its only teardown and is idempotent.
export class SceneSession {
	private readonly store: SceneStore;
	private readonly onError: ((error: unknown) => void) | undefined;
	private readonly observer: PresentationObserver | undefined;
	private readonly onMarkerActivate: ((activation: MarkerActivation) => void) | undefined;
	private scene: GlobeScene | undefined;
	private releaseOrientation: () => void = noop;
	private releaseScale: () => void = noop;
	private releaseImagery: () => void = noop;
	private releaseInteraction: () => void = noop;
	private releaseActivation: () => void = noop;
	private stopScene: () => void = noop;
	private imageryDegraded = false;
	private settled = false;
	private free = false;
	private target: SceneTarget | undefined;
	private atlas: AtlasView | undefined;
	private markers: readonly AtlasMarker[] | undefined;
	private stage: StageSize | undefined;
	private stopped = false;
	private revealed = false;
	private presentation = 0;
	private overview: OverviewStage = 'away';
	private orbiting = false;
	/** The reader paused the ambient orbit; kept until they resume it, across atlas visits. */
	private rotationPaused = false;

	constructor({
		ionToken,
		createScene,
		store,
		onError,
		observer,
		onMarkerActivate
	}: SceneSessionOptions) {
		this.store = store;
		this.onError = onError;
		this.observer = observer;
		this.onMarkerActivate = onMarkerActivate;

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

	/**
	 * Presents a mountain, or with `undefined` lets go of the one presented: its flight stops where
	 * it is and its summit marker goes. The camera then belongs to free navigation, and on the atlas
	 * flies from wherever it stopped to the overview.
	 */
	setTarget(next: SceneTarget | undefined): void {
		if (this.stopped) {
			return;
		}
		const previous = this.target;
		this.target = next;
		if (this.scene && next) {
			this.begin(next);
			return;
		}
		if (this.scene && previous) {
			this.release(this.scene);
			if (this.atlas) {
				void this.flyToOverview(this.scene, this.atlas);
			}
			return;
		}
		if (next && this.store.getSnapshot().state.status === 'failed') {
			this.observer?.ended();
		}
	}

	/**
	 * Where a free camera returns to. Arriving on the atlas with no mountain to let go of flies there
	 * at once; with one, letting it go does. Leaving the atlas ends the ambient orbit.
	 */
	setAtlas(next: AtlasView | undefined): void {
		if (this.stopped) {
			return;
		}
		const previous = this.atlas;
		this.atlas = next;
		if (!next) {
			this.leaveOverview();
			return;
		}
		if (!previous && this.scene && this.revealed && !this.target) {
			void this.flyToOverview(this.scene, next);
			return;
		}
		this.publishRotation();
	}

	/**
	 * The mountains drawn on the globe, kept apart from the overview so a new catalog never moves
	 * the camera. Kept for a scene that does not exist yet, such as one a retry builds.
	 */
	setAtlasMarkers(next: readonly AtlasMarker[] | undefined): void {
		if (this.stopped) {
			return;
		}
		this.markers = next;
		this.scene?.setAtlasMarkers(next);
	}

	/** Pauses the ambient orbit, or resumes it, flying back to the overview if the camera left it. */
	toggleRotation(): void {
		const state = this.rotationState();
		if (state === 'off' || !this.scene || !this.atlas) {
			return;
		}
		if (state === 'rotating') {
			this.rotationPaused = true;
			this.haltOrbit();
			return;
		}
		this.rotationPaused = false;
		if (this.overview === 'away' && this.free) {
			void this.flyToOverview(this.scene, this.atlas);
			return;
		}
		this.resumeOrbit();
	}

	updateStage(size: StageSize): void {
		if (this.stopped) {
			return;
		}
		this.stage = size;
		this.scene?.updateStage(size);
		this.refitOverview(size);
	}

	// A presented mountain resets to its own pose; a free camera to the atlas overview, if any.
	resetView(): ResetResult {
		if (!this.scene) {
			return 'unavailable';
		}
		if (this.settled) {
			return this.scene.resetView();
		}
		if (this.free && this.atlas) {
			void this.flyToOverview(this.scene, this.atlas);
			return 'reset';
		}

		return 'unavailable';
	}

	// Gated like Reset: an explicit step must not fight the reveal or a flight between mountains.
	zoomView(direction: ZoomDirection): ZoomResult {
		if (!this.scene || !(this.settled || this.free)) {
			return 'unavailable';
		}
		this.leaveOverview();
		return this.scene.zoomView(direction);
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
		this.publishFree(false);
		this.orbiting = false;
		this.publishRotation();
		this.store.setOrientation(undefined);
		this.store.setScale(undefined);
		this.scene = undefined;
		this.observer?.ended();

		const {
			releaseOrientation,
			releaseScale,
			releaseImagery,
			releaseInteraction,
			releaseActivation,
			stopScene
		} = this;
		this.releaseOrientation = noop;
		this.releaseScale = noop;
		this.releaseImagery = noop;
		this.releaseInteraction = noop;
		this.releaseActivation = noop;
		this.stopScene = noop;

		// The scene goes last: a retry must never meet a live Viewer because a release threw.
		releaseBestEffort('Scene session', [
			['orientation subscription', releaseOrientation],
			['scale subscription', releaseScale],
			['imagery subscription', releaseImagery],
			['interaction subscription', releaseInteraction],
			['marker activation subscription', releaseActivation],
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
		this.releaseInteraction = ready.subscribeInteraction(() => this.interacted());
		const onMarkerActivate = this.onMarkerActivate;
		if (onMarkerActivate) {
			this.releaseActivation = ready.subscribeMarkerActivation((activation) => {
				if (!this.stopped && this.markers) {
					onMarkerActivate(activation);
				}
			});
		}

		if (this.stage) {
			ready.updateStage(this.stage);
		}
		if (this.markers) {
			ready.setAtlasMarkers(this.markers);
		}
		if (this.target) {
			this.begin(this.target);
			return;
		}
		if (this.atlas) {
			void this.revealOverview(ready, this.atlas);
			return;
		}
		this.revealed = true;
		this.publishReady();
		this.publishFree(true);
	}

	// Placed at once, like a direct reveal: the loader stays until the globe under it has loaded.
	private async revealOverview(ready: GlobeScene, atlas: AtlasView): Promise<void> {
		const ticket = ++this.presentation;
		this.overview = 'arriving';
		let outcome: CameraOutcome;
		try {
			outcome = await ready.showOverview(atlasOverviewLook(atlas, this.stage), false);
		} catch (error) {
			this.failSetup(error);
			return;
		}
		if (!this.isCurrent(ticket)) {
			return;
		}
		await ready.whenViewReady().catch(() => undefined);
		if (!this.isCurrent(ticket)) {
			return;
		}
		this.revealed = true;
		this.publishReady();
		this.publishFree(true);
		this.settleOverview(outcome);
	}

	// A failed flight leaves the camera wherever it stopped, which is still a free camera.
	private async flyToOverview(ready: GlobeScene, atlas: AtlasView): Promise<void> {
		const ticket = ++this.presentation;
		this.haltOrbit();
		this.overview = 'arriving';
		this.publishFree(false);
		this.publishRotation();
		const outcome = await ready
			.showOverview(atlasOverviewLook(atlas, this.stage), true)
			.catch(() => FAILED_FLIGHT);
		if (!this.isCurrent(ticket)) {
			return;
		}
		this.publishFree(true);
		this.settleOverview(outcome);
	}

	// Someone who touched the globe on the way keeps it: the orbit does not start under them.
	// A camera still at the overview keeps the whole globe in view when the stage changes shape. One
	// the reader moved is theirs, and a flight in progress is aimed at the old shape, so it restarts.
	private refitOverview(size: StageSize): void {
		const ready = this.scene;
		if (!ready || !this.atlas || this.overview === 'away' || !(stageAspect(size) > 0)) {
			return;
		}
		if (ready.refitRange(overviewRangeMeters(size)) === 'busy') {
			void this.flyToOverview(ready, this.atlas);
		}
	}

	private settleOverview(outcome: CameraOutcome): void {
		if (this.overview === 'arriving') {
			this.overview = outcome.status === 'arrived' ? 'idle' : 'away';
		}
		this.resumeOrbit();
	}

	private resumeOrbit(): void {
		const ready = this.scene;
		if (
			ready &&
			this.atlas &&
			this.revealed &&
			this.overview === 'idle' &&
			!this.rotationPaused &&
			!this.orbiting
		) {
			this.orbiting = ready.startOrbit(ATLAS_ORBIT_PERIOD_SECONDS, () => this.orbitHalted());
		}
		this.publishRotation();
	}

	private orbitHalted(): void {
		if (this.stopped) {
			return;
		}
		this.orbiting = false;
		this.overview = 'away';
		this.publishRotation();
	}

	private interacted(): void {
		if (!this.stopped && (this.overview !== 'away' || this.orbiting)) {
			this.leaveOverview();
		}
	}

	private leaveOverview(): void {
		this.overview = 'away';
		this.haltOrbit();
	}

	private haltOrbit(): void {
		if (this.orbiting) {
			this.orbiting = false;
			this.scene?.stopOrbit();
		}
		this.publishRotation();
	}

	private rotationState(): RotationState {
		const ready = this.scene;
		if (this.stopped || !ready || !this.atlas || !this.revealed || !ready.canOrbit()) {
			return 'off';
		}
		return this.rotationPaused || this.overview === 'away' ? 'paused' : 'rotating';
	}

	private publishRotation(): void {
		this.store.setRotation(this.rotationState());
	}

	// The presentation ticket moves on first, so no outcome of the released target is reported. A
	// reveal still in progress ends here: there is nothing left for the loader to wait for.
	private release(ready: GlobeScene): void {
		this.presentation += 1;
		this.leaveOverview();
		this.publishSettled(false);
		ready.clearTarget();
		this.observer?.cleared();
		if (!this.revealed) {
			this.revealed = true;
			this.publishReady();
		}
		this.publishFree(true);
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

	private publishFree(next: boolean): void {
		if (next === this.free) {
			return;
		}
		this.free = next;
		this.store.setFree(next);
	}

	private publishCamera(target: SceneTarget, outcome: CameraOutcome): void {
		this.publishSettled(outcome.status === 'arrived');
		this.observer?.presented(target, outcome.status);
	}

	private begin(next: SceneTarget): void {
		this.leaveOverview();
		const ticket = ++this.presentation;
		this.publishSettled(false);
		this.publishFree(false);
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
