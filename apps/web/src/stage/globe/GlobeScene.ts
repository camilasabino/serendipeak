import type { Destroyable } from '../lifecycle';
import type { AtlasMarker } from './atlasMarkers';
import type { SceneTarget } from './camera';
import type { CameraReading } from './cameraReading';
import type { CameraOutcome } from './choreography';
import type { LookState } from './glidePath';
import type { MountainPlacement, ResetResult } from './mountainCamera';
import type { ViewOrientation } from './orientation';
import type { ScaleReading } from './scaleBar';
import type { StageSize } from './stageFrame';
import type { ZoomDirection, ZoomResult } from './zoomStep';

export type RefitResult = 'refitted' | 'busy' | 'unavailable';

export interface GlobeScene extends Destroyable {
	/** Places the globe look for a cinematic reveal. Returns false when the reveal is direct. */
	prepareReveal(target: SceneTarget): boolean;
	showMountain(target: SceneTarget, placement: MountainPlacement): Promise<CameraOutcome>;
	/**
	 * Lets go of the presented mountain: any presentation stops where it is, its summit marker goes
	 * and Reset no longer returns to it. The camera stays put and later presentations still work.
	 */
	clearTarget(): void;
	/** Clears any target and moves to a free look; `animate` false places it at once. */
	showOverview(look: LookState, animate: boolean): Promise<CameraOutcome>;
	/**
	 * Moves a free camera along its line of sight to `rangeMeters`, keeping its heading, tilt and
	 * place on the globe, and any orbit in progress keeps turning. `busy` while a flight owns the
	 * camera, `unavailable` where the camera cannot be placed.
	 */
	refitRange(rangeMeters: number): RefitResult;
	/** Whether ambient motion may run at all: never while the reader prefers reduced motion. */
	canOrbit(): boolean;
	/**
	 * Turns the camera slowly around the polar axis, keeping its altitude and tilt, one full turn
	 * every `periodSeconds`. It halts on stopOrbit(), any camera movement it did not make, or a
	 * switch to reduced motion; `onHalted` reports the latter two. Returns false if it cannot start.
	 */
	startOrbit(periodSeconds: number, onHalted: () => void): boolean;
	stopOrbit(): void;
	/**
	 * Draws these mountains on the globe, replacing the set drawn before, or with `undefined` takes
	 * them away at once. Markers only show where they can be seen: in front of the camera, above the
	 * horizon and inside the stage. They take no input and never move the camera.
	 */
	setAtlasMarkers(markers: readonly AtlasMarker[] | undefined): void;
	/** Direct input on the globe, a press or a wheel. A new subscription replaces the previous one. */
	subscribeInteraction(listener: () => void): () => void;
	/** Resolves when the view is ready, superseded by a later call, or the scene is destroyed. */
	whenViewReady(): Promise<void>;
	updateStage(size: StageSize): void;
	/** A new subscription replaces the previous one. */
	subscribeOrientation(listener: (orientation: ViewOrientation | undefined) => void): () => void;
	subscribeImageryHealth(listener: (degraded: boolean) => void): () => void;
	/** A new subscription replaces the previous one. */
	subscribeScale(listener: (reading: ScaleReading | undefined) => void): () => void;
	resetView(): ResetResult;
	/** One explicit zoom step; `unavailable` while choreography owns the camera. */
	zoomView(direction: ZoomDirection): ZoomResult;
	/** The live canonical pose, or undefined while a flight runs or the view cannot be read. */
	readCamera(): CameraReading | undefined;
	/** Idempotent. After it returns the scene owns no listener, timer or Viewer. */
	destroy(): void;
}
