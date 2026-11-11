import { describe, expect, it } from 'vitest';
import type { SceneState } from './sceneState';
import { stageControlsFor } from './stageControls';

const FAILED: SceneState = {
	status: 'failed',
	failure: 'initialization-failed',
	message: 'The 3D globe could not be loaded.'
};

describe('stageControlsFor', () => {
	it('shows no controls while the globe is loading', () => {
		expect(stageControlsFor({ status: 'loading' }, false)).toEqual({
			visible: false,
			resetEnabled: false,
			zoomEnabled: false
		});
		expect(stageControlsFor({ status: 'loading' }, true)).toMatchObject({
			resetEnabled: false,
			zoomEnabled: false
		});
	});

	it('shows no controls over a failed scene, even if a stale settled flag remains', () => {
		expect(stageControlsFor(FAILED, true)).toEqual({
			visible: false,
			resetEnabled: false,
			zoomEnabled: false
		});
		expect(
			stageControlsFor({ status: 'failed', failure: 'missing-token', message: 'x' }, true).visible
		).toBe(false);
	});

	it('shows controls but keeps Reset and zoom disabled until the mountain settles', () => {
		expect(stageControlsFor({ status: 'ready' }, false)).toEqual({
			visible: true,
			resetEnabled: false,
			zoomEnabled: false
		});
	});

	it('enables Reset and zoom on a ready, settled scene', () => {
		expect(stageControlsFor({ status: 'ready' }, true)).toEqual({
			visible: true,
			resetEnabled: true,
			zoomEnabled: true
		});
	});

	it('treats degraded imagery as an ordinary ready scene', () => {
		expect(stageControlsFor({ status: 'ready', imageryDegraded: true }, true)).toEqual({
			visible: true,
			resetEnabled: true,
			zoomEnabled: true
		});
	});
});
