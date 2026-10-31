import type { SceneState } from './sceneState';

export interface StageControls {
	visible: boolean;
	resetEnabled: boolean;
}

export function stageControlsFor(state: SceneState, settled: boolean): StageControls {
	const visible = state.status === 'ready';
	return { visible, resetEnabled: visible && settled };
}
