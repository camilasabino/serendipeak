import type { SceneCamera } from './camera';
import type { StageSize } from './stageFrame';

export interface CameraReading extends SceneCamera {
	displayRangeMeters: number;
	stage: StageSize;
}

export type ExposeCameraReading = (read: () => CameraReading | undefined) => () => void;
