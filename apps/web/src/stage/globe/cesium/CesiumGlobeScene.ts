import type { TerrainProvider, Viewer } from 'cesium';
import type { SceneTarget } from '../camera';
import type { CameraReading, ExposeCameraReading } from '../cameraReading';
import { CameraDirector, type CameraOutcome } from '../choreography';
import type { GlobeScene } from '../GlobeScene';
import { FailedLayerRemoval } from '../failedLayerRemoval';
import { ImageryMonitor } from '../imageryMonitor';
import { SENTINEL2_ASSET_ID, createBaseLayer, type ImageryMode } from '../imagery';
import {
	createMountainCamera,
	type MountainCamera,
	type MountainPlacement,
	type ResetResult
} from '../mountainCamera';
import { OrientationTracker, type ViewOrientation } from '../orientationTracker';
import { isLookAtOffset } from '../resetPose';
import type { ScaleReading } from '../scaleBar';
import { ScaleTracker } from '../scaleTracker';
import type { StageSize } from '../stageFrame';
import { createTerrainCameraSession, type TerrainCameraSession } from '../terrainCamera';
import { globeLook, motionPreference, type MotionPreference } from '../transitionPlan';
import { disableEntityPicking, stageViewerOptions } from '../viewerOptions';
import type { CesiumModule } from './CesiumModule';
import { createCesiumTerrainSource } from './cesiumTerrain';
import { SummitMarkers } from './SummitMarkers';
import { ViewerCameraFlight } from './ViewerCameraFlight';
import { ViewSampler } from './ViewSampler';

export const CESIUM_BASE_URL = '/cesium/';

const WIDGETS_STYLESHEET_ID = 'cesium-widgets-stylesheet';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const CAMERA_MOVE_EPSILON_METERS = 0.5;
const CAMERA_TURN_EPSILON = 1e-5;

export interface CesiumSceneConfig {
	ionToken: string;
	imageryMode: ImageryMode;
	exposeCameraReading?: ExposeCameraReading;
}

interface ViewReadyWaiter {
	settle(): void;
}

interface SceneParts {
	cesium: CesiumModule;
	viewer: Viewer;
	terrainProvider: TerrainProvider;
	imagery: ImageryMonitor;
	failedBaseLayer: FailedLayerRemoval<unknown> | undefined;
	container: HTMLElement;
}

const noop = () => {};

export class CesiumGlobeScene implements GlobeScene {
	private readonly cesium: CesiumModule;
	private readonly viewer: Viewer;
	private readonly container: HTMLElement;
	private readonly imagery: ImageryMonitor;
	private readonly failedBaseLayer: FailedLayerRemoval<unknown> | undefined;
	private readonly sampler: ViewSampler;
	private readonly flight: ViewerCameraFlight;
	private readonly camera: MountainCamera;
	private readonly terrainSession: TerrainCameraSession;
	private readonly reducedMotion: MediaQueryList;
	private stage: StageSize = { width: 0, height: 0 };
	private scaleTracker: ScaleTracker | undefined;
	private releaseOrientation: () => void = noop;
	private releaseScale: () => void = noop;
	private releaseCameraReading: () => void = noop;
	private viewReadyWaiter: ViewReadyWaiter | undefined;
	private destroyed = false;

	static async create(
		container: HTMLElement,
		stageElement: HTMLElement,
		{ ionToken, imageryMode, exposeCameraReading }: CesiumSceneConfig,
		signal: AbortSignal
	): Promise<CesiumGlobeScene> {
		// Cesium reads the base URL lazily, so it must be set before the module is first used.
		(window as Window & { CESIUM_BASE_URL?: string }).CESIUM_BASE_URL = CESIUM_BASE_URL;

		const [cesium] = await Promise.all([import('cesium'), ensureWidgetStyles()]);
		signal.throwIfAborted();

		cesium.Ion.defaultAccessToken = ionToken;

		const terrainProvider = await cesium.createWorldTerrainAsync();
		signal.throwIfAborted();

		const baseLayer = createBaseLayer(imageryMode, {
			sentinel2: () =>
				cesium.ImageryLayer.fromProviderAsync(
					cesium.IonImageryProvider.fromAssetId(SENTINEL2_ASSET_ID)
				),
			world: () => cesium.ImageryLayer.fromWorldImagery({})
		});
		const failedBaseLayer = baseLayer ? new FailedLayerRemoval(baseLayer) : undefined;
		const imagery = new ImageryMonitor(baseLayer, {
			onDegraded: () => console.warn('Base imagery degraded; the scene continues without it.'),
			onLayerFailed: () => failedBaseLayer?.layerFailed()
		});

		let viewer: Viewer;
		try {
			viewer = new cesium.Viewer(container, {
				terrainProvider,
				baseLayer,
				...stageViewerOptions(stageElement)
			});
		} catch (error) {
			imagery.release();
			failedBaseLayer?.release();
			if (baseLayer && !baseLayer.isDestroyed()) {
				baseLayer.destroy();
			}
			// A failed constructor can leave its half-built DOM behind.
			container.querySelector(':scope > .cesium-viewer')?.remove();
			container.querySelector(':scope > .cesium-widget')?.remove();
			throw error;
		}

		let scene: CesiumGlobeScene | undefined;
		try {
			failedBaseLayer?.attach(viewer.scene.imageryLayers);
			disableEntityPicking(viewer, cesium.ScreenSpaceEventType);

			const built = new CesiumGlobeScene({
				cesium,
				viewer,
				terrainProvider,
				imagery,
				failedBaseLayer,
				container
			});
			scene = built;
			built.releaseCameraReading = exposeCameraReading?.(() => built.readCamera()) ?? noop;
		} catch (error) {
			if (scene) {
				scene.destroy();
			} else {
				imagery.release();
				failedBaseLayer?.release();
				// The viewer owns the base layer once constructed and destroys it with itself.
				viewer.destroy();
			}
			throw error;
		}

		return scene;
	}

	private constructor({
		cesium,
		viewer,
		terrainProvider,
		imagery,
		failedBaseLayer,
		container
	}: SceneParts) {
		this.cesium = cesium;
		this.viewer = viewer;
		this.container = container;
		this.imagery = imagery;
		this.failedBaseLayer = failedBaseLayer;
		this.reducedMotion = window.matchMedia(REDUCED_MOTION_QUERY);
		this.sampler = new ViewSampler(cesium, viewer);
		this.flight = new ViewerCameraFlight(cesium, viewer, this.sampler, () => this.measureStage());
		this.terrainSession = createTerrainCameraSession();

		const markers = new SummitMarkers(cesium, viewer);
		const terrain = createCesiumTerrainSource(cesium, terrainProvider);
		const director = new CameraDirector(this.flight, markers, {
			cameraHeight: () => viewer.camera.positionCartographic.height,
			motion: () => this.motion()
		});

		this.camera = createMountainCamera({
			resolvePose: (target, size) =>
				this.terrainSession.resolve({
					slug: target.slug,
					latitude: target.latitude,
					longitude: target.longitude,
					elevationMeters: target.elevationMeters,
					stageWidth: size.width,
					stageHeight: size.height,
					terrain,
					camera: target.camera
				}),
			measure: () => this.measureStage(),
			reducedMotion: () => this.reducedMotion.matches,
			director,
			markers,
			isAtPose: (target, offset) => {
				const look = this.flight.look();
				return look !== undefined && isLookAtOffset(look, target, offset);
			},
			hasMovedFrom: (target, offset) => {
				const look = this.flight.look();
				return look !== undefined && !isLookAtOffset(look, target, offset, { framing: false });
			}
		});
	}

	prepareReveal(target: SceneTarget): boolean {
		if (this.destroyed || this.motion() === 'direct') {
			return false;
		}

		return this.flight.applyLook(
			globeLook({
				latitude: target.latitude,
				longitude: target.longitude,
				altitudeMeters: target.elevationMeters
			})
		);
	}

	async showMountain(target: SceneTarget, placement: MountainPlacement): Promise<CameraOutcome> {
		if (this.destroyed) {
			return { status: 'interrupted' };
		}

		const outcome = await this.camera.show(target, placement);
		if (!this.destroyed) {
			this.viewer.resize();
		}

		return outcome;
	}

	whenViewReady(): Promise<void> {
		this.viewReadyWaiter?.settle();

		return new Promise((resolve) => {
			if (this.destroyed) {
				resolve();
				return;
			}

			const waiter: ViewReadyWaiter = {
				settle: () => {
					removeListener();
					if (this.viewReadyWaiter === waiter) {
						this.viewReadyWaiter = undefined;
					}
					resolve();
				}
			};
			const removeListener = this.viewer.scene.postRender.addEventListener(() => {
				const ready =
					this.viewer.scene.globe.tilesLoaded ||
					(this.imagery.degraded && !this.failedBaseLayer?.removed);
				if (ready) {
					waiter.settle();
				}
			});
			this.viewReadyWaiter = waiter;
		});
	}

	updateStage(size: StageSize): void {
		if (this.destroyed) {
			return;
		}

		this.stage = size;
		this.camera.updateStage(size);
		this.scaleTracker?.refresh();
	}

	resetView(): ResetResult {
		if (this.destroyed) {
			return 'unavailable';
		}

		const result = this.camera.reset();
		if (result === 'reset') {
			this.flight.holdInputs();
		}

		return result;
	}

	subscribeOrientation(listener: (orientation: ViewOrientation | undefined) => void): () => void {
		this.releaseOrientation();
		this.releaseOrientation = noop;

		if (this.destroyed) {
			listener(undefined);
			return noop;
		}

		const tracker = new OrientationTracker({
			sample: () => {
				const heading = this.sampler.viewHeading();
				return Number.isFinite(heading) ? { viewHeadingDegrees: heading } : undefined;
			},
			publish: listener,
			listen: (onFrame) => {
				const remove = this.viewer.scene.preUpdate.addEventListener(onFrame);
				return () => {
					remove();
				};
			}
		});
		const release = () => tracker.release();
		this.releaseOrientation = release;

		return () => {
			release();
			if (this.releaseOrientation === release) {
				this.releaseOrientation = noop;
			}
		};
	}

	subscribeScale(listener: (reading: ScaleReading | undefined) => void): () => void {
		this.releaseScale();
		this.releaseScale = noop;
		this.scaleTracker = undefined;

		if (this.destroyed) {
			listener(undefined);
			return noop;
		}

		const tracker = new ScaleTracker({
			sample: () => this.sampler.groundScale(),
			publish: listener,
			listen: (onChange) => this.listenForViewChanges(onChange)
		});
		const release = () => {
			tracker.release();
			if (this.scaleTracker === tracker) {
				this.scaleTracker = undefined;
			}
		};
		this.scaleTracker = tracker;
		this.releaseScale = release;

		return () => {
			release();
			if (this.releaseScale === release) {
				this.releaseScale = noop;
			}
		};
	}

	subscribeImageryHealth(listener: (degraded: boolean) => void): () => void {
		return this.imagery.subscribe(listener);
	}

	readCamera(): CameraReading | undefined {
		return this.destroyed ? undefined : this.flight.cameraReading();
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		this.releaseCameraReading();
		this.releaseCameraReading = noop;

		this.viewReadyWaiter?.settle();
		this.imagery.release();
		this.failedBaseLayer?.release();
		this.releaseOrientation();
		this.releaseOrientation = noop;
		this.releaseScale();
		this.releaseScale = noop;
		this.camera.stop();
		this.flight.release();

		if (!this.viewer.isDestroyed()) {
			this.viewer.destroy();
		}
	}

	private motion(): MotionPreference {
		return motionPreference(this.reducedMotion.matches, false);
	}

	private measureStage(): StageSize {
		if (this.stage.width > 0 && this.stage.height > 0) {
			return this.stage;
		}

		return { width: this.container.clientWidth, height: this.container.clientHeight };
	}

	private listenForViewChanges(onChange: () => void): () => void {
		const { Cartesian3 } = this.cesium;
		const { camera, scene } = this.viewer;
		const position = Cartesian3.clone(camera.positionWC);
		const direction = Cartesian3.clone(camera.directionWC);
		let width = scene.canvas.clientWidth;
		let height = scene.canvas.clientHeight;

		const removeFrame = scene.preUpdate.addEventListener(() => {
			const resized = scene.canvas.clientWidth !== width || scene.canvas.clientHeight !== height;
			const moved = !Cartesian3.equalsEpsilon(
				camera.positionWC,
				position,
				0,
				CAMERA_MOVE_EPSILON_METERS
			);
			const turned = !Cartesian3.equalsEpsilon(
				camera.directionWC,
				direction,
				CAMERA_TURN_EPSILON,
				0
			);
			if (!resized && !moved && !turned) {
				return;
			}

			width = scene.canvas.clientWidth;
			height = scene.canvas.clientHeight;
			Cartesian3.clone(camera.positionWC, position);
			Cartesian3.clone(camera.directionWC, direction);
			onChange();
		});
		const removeTiles = scene.globe.tileLoadProgressEvent.addEventListener((pending) => {
			if (pending === 0) {
				onChange();
			}
		});

		return () => {
			removeFrame();
			removeTiles();
		};
	}
}

function ensureWidgetStyles(): Promise<void> {
	const existing = document.getElementById(WIDGETS_STYLESHEET_ID);
	const link = existing instanceof HTMLLinkElement ? existing : createWidgetsStylesheetLink();

	if (link.sheet) {
		return Promise.resolve();
	}

	return new Promise((resolve, reject) => {
		link.addEventListener('load', () => resolve(), { once: true });
		link.addEventListener(
			'error',
			() => {
				// Removed so a later create can retry instead of waiting on a dead link.
				link.remove();
				reject(new Error(`Cesium widgets stylesheet failed to load from ${link.href}.`));
			},
			{ once: true }
		);
	});
}

function createWidgetsStylesheetLink(): HTMLLinkElement {
	const link = document.createElement('link');
	link.id = WIDGETS_STYLESHEET_ID;
	link.rel = 'stylesheet';
	link.href = `${CESIUM_BASE_URL}Widgets/widgets.css`;
	document.head.append(link);

	return link;
}
