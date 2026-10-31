import type { SceneState } from './sceneState';

export function sceneBlocksExperience(state: SceneState): boolean {
	return state.status === 'loading';
}

export function preparingLabel(isToday: boolean): string {
	return isToday ? "Revealing today's mountain..." : 'Revealing the mountain...';
}
