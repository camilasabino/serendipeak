import type { SceneState } from './sceneState';

export interface StageControls {
	visible: boolean;
	resetEnabled: boolean;
	zoomEnabled: boolean;
}

// Settled and free are the two states in which no choreography owns the camera.
export function stageControlsFor(
	state: SceneState,
	camera: { settled: boolean; free: boolean }
): StageControls {
	const visible = state.status === 'ready';
	const cameraFree = visible && (camera.settled || camera.free);
	return { visible, resetEnabled: cameraFree, zoomEnabled: cameraFree };
}
