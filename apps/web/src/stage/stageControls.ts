import type { SceneState } from './sceneState';

export interface StageControls {
	visible: boolean;
	resetEnabled: boolean;
	zoomEnabled: boolean;
}

export function stageControlsFor(state: SceneState, settled: boolean): StageControls {
	const visible = state.status === 'ready';
	const cameraFree = visible && settled;
	return { visible, resetEnabled: cameraFree, zoomEnabled: cameraFree };
}
