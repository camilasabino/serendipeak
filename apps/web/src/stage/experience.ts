import type { SceneState } from './sceneState';

export function sceneBlocksExperience(state: SceneState): boolean {
	return state.status === 'loading';
}

// A missing token is build-time configuration: it cannot change while the page is open.
export function sceneCanRetry(state: SceneState): boolean {
	return state.status === 'failed' && state.failure !== 'missing-token';
}

export function preparingLabel(isToday: boolean): string {
	return isToday ? "Revealing today's mountain..." : 'Revealing the mountain...';
}
