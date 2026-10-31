import { describe, expect, it } from 'vitest';
import { preparingLabel, sceneBlocksExperience, sceneCanRetry } from './experience';
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

describe('scene retry policy', () => {
	it('offers retry only for a failure that a new attempt can recover from', () => {
		expect(sceneCanRetry(failed)).toBe(true);
	});

	it('offers no retry for a configuration failure that cannot change on this page', () => {
		expect(sceneCanRetry({ status: 'failed', failure: 'missing-token', message: 'no token' })).toBe(
			false
		);
	});

	it('offers no retry while loading or when the scene is ready', () => {
		expect(sceneCanRetry({ status: 'loading' })).toBe(false);
		expect(sceneCanRetry({ status: 'ready' })).toBe(false);
		expect(sceneCanRetry({ status: 'ready', imageryDegraded: true })).toBe(false);
	});
});
