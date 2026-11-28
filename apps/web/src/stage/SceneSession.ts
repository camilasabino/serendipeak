import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '../units/unitSystem';
import {
	ATLAS_ORBIT_PERIOD_SECONDS,
	atlasOverviewLook,
	sameAtlasFocus,
	type AtlasView
} from './globe/atlasView';
import type { AtlasMarker } from './globe/atlasMarkers';
import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import type { CameraOutcome } from './globe/choreography';
import type { LookState } from './globe/glidePath';
import type { GlobeScene } from './globe/GlobeScene';
import { MissingIonTokenError, requireIonToken } from './globe/ionToken';
import type { MarkerActivation } from './globe/markerActivation';
import type { ResetResult } from './globe/mountainCamera';
import { MOUNTAIN_ORBIT_PERIOD_SECONDS } from './globe/mountainOrbit';
import { stageAspect, type StageSize } from './globe/stageFrame';
import type { SightedSummit, SummitSightings } from './globe/summitSighting';
import type { ZoomDirection, ZoomResult } from './globe/zoomStep';
import { startScene } from './lifecycle';
import { releaseBestEffort } from './releaseBestEffort';
import { INITIALIZATION_FAILED_STATE } from './sceneState';
import type { MountainOrbitState, RotationState, SceneStore } from './SceneStore';

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
	/**
	 * Where the nearby summits lie relative to the camera, heard only while a mountain's
	 * presentation is over and there are nearby summits; `undefined` whenever that ends.
	 */
	onSightings?: (sightings: SummitSightings | undefined) => void;
}

const noop = () => {};

const FAILED_FLIGHT: CameraOutcome = { status: 'failed', error: undefined };

/**
 * Where the atlas camera stands relative to where the atlas rests it, which is the overview or, while
 * geographic filters are in force, their region: `arriving` while placed or flown there, `idle` once
 * there and untouched, which is when the ambient orbit may turn the overview, and `away` after
 * anything else moved it.
 */
type OverviewStage = 'away' | 'arriving' | 'idle';

/** What the reader last asked of the mountain orbit; it only turns while a mountain is settled. */
type MountainOrbitIntent = Extract<MountainOrbitState, 'idle' | 'orbiting' | 'paused'>;

// The constructor starts the session; `stop()` is its only teardown and is idempotent.
export class SceneSession {
	private readonly store: SceneStore;
	private readonly onError: ((error: unknown) => void) | undefined;
	private readonly observer: PresentationObserver | undefined;
	private readonly onMarkerActivate: ((activation: MarkerActivation) => void) | undefined;
	private readonly onSightings: ((sightings: SummitSightings | undefined) => void) | undefined;
	private scene: GlobeScene | undefined;
	private releaseOrientation: () => void = noop;
	private releaseScale: () => void = noop;
	private releaseImagery: () => void = noop;
	private releaseInteraction: () => void = noop;
	private releaseActivation: () => void = noop;
	private releaseFailure: () => void = noop;
	private releaseFlight: () => void = noop;
	private releaseSightings: () => void = noop;
	private stopScene: () => void = noop;
	private imageryDegraded = false;
	private settled = false;
	/** A flight owns the camera: between mountains, a Reset, or a reframe after the stage changed. */
	private flying = false;
	private free = false;
	private target: SceneTarget | undefined;
	private atlas: AtlasView | undefined;
	private markers: readonly AtlasMarker[] | undefined;
	private stage: StageSize | undefined;
	private units: UnitSystem = DEFAULT_UNIT_SYSTEM;
	private summitMarkerVisible = true;
	private nearby: readonly SightedSummit[] = [];
	/** The current target's presentation reported its outcome: arrived, interrupted or failed. */
	private presentationOver = false;
	private stopped = false;
	private revealed = false;
	private presentation = 0;
	private overview: OverviewStage = 'away';
	private orbiting = false;
	/** The reader paused the ambient orbit; kept until they resume it, across atlas visits. */
	private rotationPaused = false;
	private mountainOrbit: MountainOrbitIntent = 'idle';

	constructor({
		ionToken,
		createScene,
		store,
		onError,
		observer,
		onMarkerActivate,
		onSightings
	}: SceneSessionOptions) {
		this.store = store;
		this.onError = onError;
		this.observer = observer;
		this.onMarkerActivate = onMarkerActivate;
		this.onSightings = onSightings;

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
	 *
	 * Changing the places the atlas frames flies to the new framing, unless it would not move the
	 * camera from where a camera that has not been touched already stands. The camera is only ever
	 * moved from here, never from a render, and a flight toward an older framing is superseded.
	 */
	setAtlas(next: AtlasView | undefined): void {
		if (this.stopped) {
			return;
		}
		const previous = this.atlas;
		this.atlas = next;
		if ((previous === undefined) !== (next === undefined)) {
			this.scene?.setAtlasPresentation(next !== undefined);
		}
		if (!next) {
			this.leaveOverview();
			return;
		}
		if (!previous && this.scene && this.revealed && !this.target) {
			void this.flyToOverview(this.scene, next);
			return;
		}
		if (previous && this.scene && !this.target && !sameAtlasFocus(previous.focus, next.focus)) {
			this.reframe(this.scene, previous, next);
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

	/**
	 * Whether the presented mountain's summit marker is drawn. Kept for a scene that does not exist
	 * yet, such as one a retry builds, and applied before the first mountain is presented. Never
	 * restarts a presentation or moves the camera.
	 */
	setSummitMarkerVisible(next: boolean): void {
		if (this.stopped) {
			return;
		}
		this.summitMarkerVisible = next;
		this.scene?.setSummitMarkerVisible(next);
	}

	/**
	 * The unit the scene words its labels in. Kept for a scene that does not exist yet, such as one
	 * a retry builds, and applied to a ready scene before it draws anything. Presentation is never
	 * restarted by it.
	 */
	setUnitSystem(next: UnitSystem): void {
		if (this.stopped) {
			return;
		}
		this.units = next;
		this.scene?.setUnitSystem(next);
	}

	/**
	 * The summits near the presented mountain, followed relative to the camera once its
	 * presentation is over. Kept for a scene that does not exist yet, such as one a retry builds;
	 * an empty list follows nothing. Never moves the camera.
	 */
	setNearbySummits(next: readonly SightedSummit[]): void {
		if (this.stopped) {
			return;
		}
		this.nearby = next;
		this.followSightings();
	}

	/** A transient emphasis for one atlas marker; not kept for a scene that does not exist yet. */
	highlightMarker(slug: string | undefined): void {
		if (!this.stopped) {
			this.scene?.highlightAtlasMarker(slug);
		}
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

	/**
	 * Starts circling the settled mountain from wherever the camera is, pauses it where it is, or
	 * resumes it from there. Nothing happens while no mountain is settled or a flight owns the
	 * camera, and the camera is never sent back to the mountain's pose.
	 */
	toggleMountainOrbit(): void {
		const ready = this.scene;
		const state = this.mountainOrbitState();
		if (!ready || state === 'off' || state === 'unavailable') {
			return;
		}
		if (state === 'orbiting') {
			this.mountainOrbit = 'paused';
			ready.stopMountainOrbit();
		} else if (
			ready.startMountainOrbit(MOUNTAIN_ORBIT_PERIOD_SECONDS, () => this.mountainOrbitHalted())
		) {
			this.mountainOrbit = 'orbiting';
		}
		this.publishMountainOrbit();
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
			this.endMountainOrbit();
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
		this.endMountainOrbit();
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
		this.mountainOrbit = 'idle';
		this.publishMountainOrbit();
		this.store.setOrientation(undefined);
		this.store.setScale(undefined);
		this.scene = undefined;
		this.presentationOver = false;
		this.observer?.ended();

		const {
			releaseOrientation,
			releaseScale,
			releaseImagery,
			releaseInteraction,
			releaseActivation,
			releaseFailure,
			releaseFlight,
			releaseSightings,
			stopScene
		} = this;
		this.releaseOrientation = noop;
		this.releaseScale = noop;
		this.releaseImagery = noop;
		this.releaseInteraction = noop;
		this.releaseActivation = noop;
		this.releaseFailure = noop;
		this.releaseFlight = noop;
		this.releaseSightings = noop;
		this.stopScene = noop;

		// The scene goes last: a retry must never meet a live Viewer because a release threw.
		releaseBestEffort('Scene session', [
			['orientation subscription', releaseOrientation],
			['scale subscription', releaseScale],
			['imagery subscription', releaseImagery],
			['interaction subscription', releaseInteraction],
			['marker activation subscription', releaseActivation],
			['render failure subscription', releaseFailure],
			['flight subscription', releaseFlight],
			['sighting subscription', releaseSightings],
			['scene', stopScene]
		]);
	}

	// A scene that exists but cannot be wired, or stops rendering later, must still end in the failed
	// state; stop() releases whatever was wired and destroys the scene, so a retry never meets a
	// second live Viewer. A late or repeated report finds the session stopped and does nothing.
	private failScene(error: unknown): void {
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
			this.failScene(error);
		}
	}

	private wire(ready: GlobeScene): void {
		this.scene = ready;
		this.flying = false;
		ready.setUnitSystem(this.units);
		ready.setSummitMarkerVisible(this.summitMarkerVisible);
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
		this.releaseFailure = ready.subscribeFailure((error) => this.failScene(error));
		this.releaseFlight = ready.subscribeFlight((flying) => {
			if (this.stopped || flying === this.flying) {
				return;
			}
			this.flying = flying;
			this.publishMountainOrbit();
		});
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
		ready.setAtlasPresentation(this.atlas !== undefined);
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
			this.failScene(error);
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

	// A reveal still waiting for its tiles is placed again, so it ends on the framing in force. A
	// camera the reader has moved is flown back even when the framing looks the same: the reader
	// chose these filters, and the flight is what answers them.
	private reframe(ready: GlobeScene, previous: AtlasView, next: AtlasView): void {
		if (!this.revealed) {
			void this.revealOverview(ready, next);
			return;
		}
		const unmoved =
			this.overview !== 'away' &&
			sameLook(atlasOverviewLook(previous, this.stage), atlasOverviewLook(next, this.stage));
		if (unmoved) {
			this.publishRotation();
			return;
		}
		void this.flyToOverview(ready, next);
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
		if (ready.refitRange(atlasOverviewLook(this.atlas, size).rangeMeters) === 'busy') {
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
			!this.framing &&
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

	// A gesture on the globe takes the camera from either orbit; neither resumes under the reader.
	private interacted(): void {
		if (this.stopped) {
			return;
		}
		if (this.overview !== 'away' || this.orbiting) {
			this.leaveOverview();
		}
		if (this.mountainOrbit !== 'idle') {
			this.endMountainOrbit();
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

	// The globe stays where the filters brought it, so there is no orbit to pause or resume, and the
	// reader's choice about it is kept untouched for the overview.
	private get framing(): boolean {
		return this.atlas?.focus !== undefined;
	}

	private rotationState(): RotationState {
		const ready = this.scene;
		if (
			this.stopped ||
			!ready ||
			!this.atlas ||
			this.framing ||
			!this.revealed ||
			!ready.canOrbit()
		) {
			return 'off';
		}
		return this.rotationPaused || this.overview === 'away' ? 'paused' : 'rotating';
	}

	private publishRotation(): void {
		this.store.setRotation(this.rotationState());
	}

	private mountainOrbitHalted(): void {
		if (this.stopped || this.mountainOrbit !== 'orbiting') {
			return;
		}
		this.mountainOrbit = 'idle';
		this.publishMountainOrbit();
	}

	// Ending it leaves the camera where it is: whatever ends it decides where the camera goes next.
	private endMountainOrbit(): void {
		if (this.mountainOrbit === 'orbiting') {
			this.scene?.stopMountainOrbit();
		}
		this.mountainOrbit = 'idle';
		this.publishMountainOrbit();
	}

	private mountainOrbitState(): MountainOrbitState {
		const ready = this.scene;
		if (this.stopped || !ready || !this.target || !ready.canOrbit()) {
			return 'off';
		}
		return this.settled && !this.flying ? this.mountainOrbit : 'unavailable';
	}

	private publishMountainOrbit(): void {
		this.store.setMountainOrbit(this.mountainOrbitState());
	}

	// The presentation ticket moves on first, so no outcome of the released target is reported. A
	// reveal still in progress ends here: there is nothing left for the loader to wait for.
	private release(ready: GlobeScene): void {
		this.presentation += 1;
		this.leaveOverview();
		this.endMountainOrbit();
		this.publishSettled(false);
		this.presentationOver = false;
		this.followSightings();
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
		this.publishMountainOrbit();
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
		this.presentationOver = true;
		this.followSightings();
		this.observer?.presented(target, outcome.status);
	}

	// Only once the presentation is over: a flight sweeps every direction past the edges, and the
	// neighbours known by then may already be those of the next mountain. Whatever the outcome,
	// the camera stands somewhere near the mountain, and the directions read from there are true.
	private followSightings(): void {
		const release = this.releaseSightings;
		this.releaseSightings = noop;
		release();

		const ready = this.scene;
		const target = this.target;
		const onSightings = this.onSightings;
		if (
			this.stopped ||
			!ready ||
			!target ||
			!onSightings ||
			!this.presentationOver ||
			this.nearby.length === 0
		) {
			return;
		}

		this.releaseSightings = ready.subscribeSightings(
			{ presented: sightedSummitOf(target), nearby: this.nearby },
			onSightings
		);
	}

	private begin(next: SceneTarget): void {
		this.leaveOverview();
		const ticket = ++this.presentation;
		this.publishSettled(false);
		this.presentationOver = false;
		this.followSightings();
		this.endMountainOrbit();
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
			this.failScene(error);
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

function sightedSummitOf({
	slug,
	latitude,
	longitude,
	elevationMeters
}: SceneTarget): SightedSummit {
	return { slug, latitude, longitude, elevationMeters };
}

const SAME_LOOK_DEGREES = 1e-4;
const SAME_LOOK_RANGE_SHARE = 1e-3;

function sameLook(a: LookState, b: LookState): boolean {
	return (
		Math.abs(a.latitude - b.latitude) < SAME_LOOK_DEGREES &&
		Math.abs(a.longitude - b.longitude) < SAME_LOOK_DEGREES &&
		Math.abs(a.rangeMeters - b.rangeMeters) <= a.rangeMeters * SAME_LOOK_RANGE_SHARE
	);
}
