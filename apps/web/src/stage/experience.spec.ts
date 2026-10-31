import { describe, expect, it } from 'vitest';
import { preparingLabel, sceneBlocksExperience } from './experience';
import type { SceneState } from './sceneState';

const failed: SceneState = {
	status: 'failed',
	failure: 'initialization-failed',
	message: 'The 3D globe could not be loaded.'
};

describe('scene experience gate', () => {
	it('keeps the mountain experience covered while the scene is loading', () => {
		expect(sceneBlocksExperience({ status: 'loading' })).toBe(true);
	});

	it('reveals the experience when the scene is ready or has failed', () => {
		expect(sceneBlocksExperience({ status: 'ready' })).toBe(false);
		expect(sceneBlocksExperience(failed)).toBe(false);
	});

	it('uses the daily revealing line only for today', () => {
		expect(preparingLabel(true)).toBe("Revealing today's mountain...");
		expect(preparingLabel(false)).toBe('Revealing the mountain...');
		expect(preparingLabel(true)).not.toMatch(/%|Loading the globe|Preparing/);
	});
});
