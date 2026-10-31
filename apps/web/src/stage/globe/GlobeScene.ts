import type { Destroyable } from '../lifecycle';
import type { SceneTarget } from './camera';
import type { CameraOutcome } from './choreography';
import type { MountainPlacement, ResetResult } from './mountainCamera';
import type { ViewOrientation } from './orientation';
import type { ScaleReading } from './scaleBar';
import type { StageSize } from './stageFrame';

export interface GlobeScene extends Destroyable {
	/** Places the globe look for a cinematic reveal. Returns false when the reveal is direct. */
	prepareReveal(target: SceneTarget): boolean;
	showMountain(target: SceneTarget, placement: MountainPlacement): Promise<CameraOutcome>;
	/** Resolves when the view is ready, superseded by a later call, or the scene is destroyed. */
	whenViewReady(): Promise<void>;
	updateStage(size: StageSize): void;
	/** A new subscription replaces the previous one. */
	subscribeOrientation(listener: (orientation: ViewOrientation | undefined) => void): () => void;
	subscribeImageryHealth(listener: (degraded: boolean) => void): () => void;
	/** A new subscription replaces the previous one. */
	subscribeScale(listener: (reading: ScaleReading | undefined) => void): () => void;
	resetView(): ResetResult;
	/** Idempotent. After it returns the scene owns no listener, timer or Viewer. */
	destroy(): void;
}
