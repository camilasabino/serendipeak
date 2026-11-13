import type { TerrainProvider, Viewer } from 'cesium';
import type { AtlasLayerReading, AtlasMarker, ExposeAtlasLayer } from '../atlasMarkers';
import type { SceneTarget } from '../camera';
import type {
	CameraReading,
	ExposeCameraReading,
	ExposeGlobePosition,
	GlobePosition
} from '../cameraReading';
import { CameraDirector, RESET_FLIGHT_SECONDS, type CameraOutcome } from '../choreography';
import type { GlobeScene, RefitResult } from '../GlobeScene';
import { FailedLayerRemoval } from '../failedLayerRemoval';
import type { LookState } from '../glidePath';
import { ImageryMonitor } from '../imageryMonitor';
import type { LabelSize } from '../labelDeclutter';
import type { MarkerActivation } from '../markerActivation';
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
import { VIEWER_OPTIONS, disableEntityPicking, enableTrackpadPinchZoom } from '../viewerOptions';
import { ZOOM_FLIGHT_SECONDS, type ZoomDirection, type ZoomResult } from '../zoomStep';
import { releaseBestEffort } from '../../releaseBestEffort';
import { AtlasMarkers } from './AtlasMarkers';
import { AtlasPicker } from './AtlasPicker';
import type { CesiumModule } from './CesiumModule';
import { createCesiumTerrainSource } from './cesiumTerrain';
import { SummitMarkers } from './SummitMarkers';
import { ViewerCameraFlight } from './ViewerCameraFlight';
import { ViewerOrbit } from './ViewerOrbit';
import { ViewSampler } from './ViewSampler';

export const CESIUM_BASE_URL = '/cesium/';

const CLEANUP_OWNER = 'Cesium scene';
const WIDGETS_STYLESHEET_ID = 'cesium-widgets-stylesheet';
const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';
const CAMERA_MOVE_EPSILON_METERS = 0.5;
const CAMERA_TURN_EPSILON = 1e-5;

export interface CesiumSceneConfig {
	ionToken: string;
	imageryMode: ImageryMode;
	exposeCameraReading?: ExposeCameraReading;
	exposeGlobePosition?: ExposeGlobePosition;
	exposeAtlasLayer?: ExposeAtlasLayer;
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
	private readonly director: CameraDirector;
	private readonly orbit: ViewerOrbit;
	private readonly atlasMarkers: AtlasMarkers;
	private readonly atlasPicker: AtlasPicker;
	private readonly camera: MountainCamera;
	private readonly terrainSession: TerrainCameraSession;
	private readonly reducedMotion: MediaQueryList;
	private stage: StageSize = { width: 0, height: 0 };
	private scaleTracker: ScaleTracker | undefined;
	private releaseOrientation: () => void = noop;
	private releaseScale: () => void = noop;
	private releaseCameraReading: () => void = noop;
	private releaseGlobePosition: () => void = noop;
	private releaseAtlasLayer: () => void = noop;
	private releaseInteraction: () => void = noop;
	private viewReadyWaiter: ViewReadyWaiter | undefined;
	private destroyed = false;

	static async create(
		container: HTMLElement,
		{
			ionToken,
			imageryMode,
			exposeCameraReading,
			exposeGlobePosition,
			exposeAtlasLayer
		}: CesiumSceneConfig,
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
				...VIEWER_OPTIONS
			});
		} catch (error) {
			releaseBestEffort(CLEANUP_OWNER, [
				['imagery monitor', () => imagery.release()],
				['failed layer removal', () => failedBaseLayer?.release()],
				[
					'base layer',
					() => {
						if (baseLayer && !baseLayer.isDestroyed()) {
							baseLayer.destroy();
						}
					}
				],
				// A failed constructor can leave its half-built DOM behind.
				[
					'partial viewer DOM',
					() => {
						container.querySelector(':scope > .cesium-viewer')?.remove();
						container.querySelector(':scope > .cesium-widget')?.remove();
					}
				]
			]);
			throw error;
		}

		let scene: CesiumGlobeScene | undefined;
		try {
			failedBaseLayer?.attach(viewer.scene.imageryLayers);
			disableEntityPicking(viewer, cesium.ScreenSpaceEventType);
			enableTrackpadPinchZoom(viewer.scene.screenSpaceCameraController, cesium);

			const built = new CesiumGlobeScene({
				cesium,
				viewer,
				terrainProvider,
				imagery,
				failedBaseLayer,
				container
			});
			scene = built;
			// The diagnostic reads mid-flight too: it observes the scene, it does not gate an edit.
			built.releaseCameraReading = exposeCameraReading?.(() => built.sampleCamera()) ?? noop;
			built.releaseGlobePosition = exposeGlobePosition?.(() => built.globePosition()) ?? noop;
			built.releaseAtlasLayer = exposeAtlasLayer?.(() => built.readAtlasLayer()) ?? noop;
		} catch (error) {
			if (scene) {
				scene.destroy();
			} else {
				// The viewer owns the base layer once constructed and destroys it with itself.
				releaseBestEffort(CLEANUP_OWNER, [
					['imagery monitor', () => imagery.release()],
					['failed layer removal', () => failedBaseLayer?.release()],
					['viewer', () => viewer.destroy()]
				]);
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
		this.orbit = new ViewerOrbit(cesium, viewer, () => this.canOrbit());
		const measureText = createTextMeasure();
		this.atlasMarkers = new AtlasMarkers(cesium, viewer, {
			listen: (onChange) => this.listenForViewChanges(onChange),
			project: (position, result) =>
				cesium.SceneTransforms.worldToWindowCoordinates(viewer.scene, position, result),
			measureText,
			refreshed: () => this.atlasPicker.refreshed()
		});
		this.atlasPicker = new AtlasPicker(cesium, viewer.scene.canvas, this.atlasMarkers);

		const markers = new SummitMarkers(cesium, viewer);
		const terrain = createCesiumTerrainSource(cesium, terrainProvider);
		this.director = new CameraDirector(this.flight, markers, {
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
			director: this.director,
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

		this.orbit.stop();
		const outcome = await this.camera.show(target, placement);
		if (!this.destroyed) {
			this.viewer.resize();
		}

		return outcome;
	}

	clearTarget(): void {
		if (!this.destroyed) {
			this.camera.clear();
		}
	}

	// A free look moves as quickly as Reset does, and holds direct input for as long.
	showOverview(look: LookState, animate: boolean): Promise<CameraOutcome> {
		if (this.destroyed) {
			return Promise.resolve({ status: 'interrupted' });
		}

		this.orbit.stop();
		this.camera.clear();
		const flying = animate && this.motion() !== 'direct';
		const arrival = new Promise<CameraOutcome>((resolve) => {
			this.director.view(look, flying ? RESET_FLIGHT_SECONDS : 0, resolve);
		});
		if (flying && this.director.busy()) {
			this.flight.holdInputs();
		}

		return arrival;
	}

	refitRange(rangeMeters: number): RefitResult {
		if (this.destroyed) {
			return 'unavailable';
		}
		if (this.director.busy()) {
			return 'busy';
		}
		if (!this.flight.setRange(rangeMeters)) {
			return 'unavailable';
		}

		this.orbit.adopt();
		return 'refitted';
	}

	canOrbit(): boolean {
		return !this.destroyed && this.motion() !== 'direct';
	}

	startOrbit(periodSeconds: number, onHalted: () => void): boolean {
		return !this.destroyed && !this.director.busy() && this.orbit.start(periodSeconds, onHalted);
	}

	stopOrbit(): void {
		this.orbit.stop();
	}

	setAtlasMarkers(markers: readonly AtlasMarker[] | undefined): void {
		if (!this.destroyed) {
			this.atlasMarkers.set(markers);
		}
	}

	subscribeMarkerActivation(listener: (activation: MarkerActivation) => void): () => void {
		return this.destroyed ? noop : this.atlasPicker.subscribe(listener);
	}

	// Heard before Cesium's own handlers act on the event, so the orbit never fights a gesture.
	subscribeInteraction(listener: () => void): () => void {
		this.releaseInteraction();
		this.releaseInteraction = noop;
		if (this.destroyed) {
			return noop;
		}

		const canvas = this.viewer.scene.canvas;
		const options = { capture: true, passive: true } as const;
		canvas.addEventListener('pointerdown', listener, options);
		canvas.addEventListener('wheel', listener, options);
		const release = () => {
			canvas.removeEventListener('pointerdown', listener, options);
			canvas.removeEventListener('wheel', listener, options);
		};
		this.releaseInteraction = release;

		return () => {
			release();
			if (this.releaseInteraction === release) {
				this.releaseInteraction = noop;
			}
		};
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

		this.orbit.stop();
		const result = this.camera.reset();
		if (result === 'reset') {
			this.flight.holdInputs();
		}

		return result;
	}

	zoomView(direction: ZoomDirection): ZoomResult {
		if (this.destroyed || this.director.busy()) {
			return 'unavailable';
		}

		this.orbit.stop();
		return this.flight.zoom(direction, this.motion() === 'direct' ? 0 : ZOOM_FLIGHT_SECONDS);
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
		return this.director.busy() ? undefined : this.sampleCamera();
	}

	destroy(): void {
		if (this.destroyed) {
			return;
		}
		this.destroyed = true;

		const releaseCameraReading = this.releaseCameraReading;
		const releaseGlobePosition = this.releaseGlobePosition;
		const releaseAtlasLayer = this.releaseAtlasLayer;
		const releaseInteraction = this.releaseInteraction;
		const releaseOrientation = this.releaseOrientation;
		const releaseScale = this.releaseScale;
		this.releaseCameraReading = noop;
		this.releaseGlobePosition = noop;
		this.releaseAtlasLayer = noop;
		this.releaseInteraction = noop;
		this.releaseOrientation = noop;
		this.releaseScale = noop;

		// One failing disposer must not strand the resources after it, and the Viewer goes last.
		releaseBestEffort(CLEANUP_OWNER, [
			['camera reading', releaseCameraReading],
			['globe position', releaseGlobePosition],
			['atlas layer reading', releaseAtlasLayer],
			['interaction listeners', releaseInteraction],
			['orbit', () => this.orbit.stop()],
			['view-ready waiter', () => this.viewReadyWaiter?.settle()],
			['imagery monitor', () => this.imagery.release()],
			['failed layer removal', () => this.failedBaseLayer?.release()],
			['orientation tracker', releaseOrientation],
			['scale tracker', releaseScale],
			['atlas picker', () => this.atlasPicker.release()],
			['atlas markers', () => this.atlasMarkers.release()],
			['camera', () => this.camera.stop()],
			['camera flight', () => this.flight.release()],
			[
				'viewer',
				() => {
					if (!this.viewer.isDestroyed()) {
						this.viewer.destroy();
					}
				}
			]
		]);
	}

	private sampleCamera(): CameraReading | undefined {
		return this.destroyed ? undefined : this.flight.cameraReading();
	}

	private readAtlasLayer(): AtlasLayerReading | undefined {
		return this.destroyed ? undefined : this.atlasMarkers.read();
	}

	private globePosition(): GlobePosition | undefined {
		if (this.destroyed) {
			return undefined;
		}
		const { Math: CesiumMath } = this.cesium;
		const { positionCartographic, positionWC } = this.viewer.camera;

		return {
			latitude: CesiumMath.toDegrees(positionCartographic.latitude),
			longitude: CesiumMath.toDegrees(positionCartographic.longitude),
			heightMeters: positionCartographic.height,
			distanceFromCenterMeters: this.cesium.Cartesian3.magnitude(positionWC),
			orbiting: this.orbit.running
		};
	}

	private motion(): MotionPreference {
		return motionPreference(this.reducedMotion.matches);
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

// Measures label text the way Cesium rasterizes it, on a 2D canvas in the same font. A browser
// without one gets an estimate rather than a failed scene: decluttering only needs a close box.
function createTextMeasure(): (text: string, font: string) => LabelSize {
	let context: CanvasRenderingContext2D | null | undefined;

	return (text, font) => {
		context ??= document.createElement('canvas').getContext('2d');
		if (!context) {
			const size = Number.parseFloat(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? '13');
			return { width: text.length * size * 0.6, height: size * 1.2 };
		}
		context.font = font;
		const metrics = context.measureText(text);

		return {
			width: metrics.width,
			height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
		};
	};
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
