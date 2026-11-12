import type { SceneCamera } from './camera';
import type { StageSize } from './stageFrame';

export interface CameraReading extends SceneCamera {
	displayRangeMeters: number;
	stage: StageSize;
}

export type ExposeCameraReading = (read: () => CameraReading | undefined) => () => void;

/** Where the camera is on the globe, read by end-to-end tests that watch free motion. */
export interface GlobePosition {
	latitude: number;
	longitude: number;
	heightMeters: number;
	distanceFromCenterMeters: number;
	orbiting: boolean;
}

export type ExposeGlobePosition = (read: () => GlobePosition | undefined) => () => void;
