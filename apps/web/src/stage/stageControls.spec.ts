import { describe, expect, it } from 'vitest';
import type { SceneState } from './sceneState';
import { stageControlsFor } from './stageControls';

const SETTLED = { settled: true, free: false };
const MOVING = { settled: false, free: false };
const FREE = { settled: false, free: true };

const FAILED: SceneState = {
	status: 'failed',
	failure: 'initialization-failed',
	message: 'The 3D globe could not be loaded.'
};

describe('stageControlsFor', () => {
	it('shows no controls while the globe is loading', () => {
		expect(stageControlsFor({ status: 'loading' }, MOVING)).toEqual({
			visible: false,
			resetEnabled: false,
			zoomEnabled: false
		});
		expect(stageControlsFor({ status: 'loading' }, SETTLED)).toMatchObject({
			resetEnabled: false,
			zoomEnabled: false
		});
	});

	it('shows no controls over a failed scene, even if a stale settled flag remains', () => {
		expect(stageControlsFor(FAILED, SETTLED)).toEqual({
			visible: false,
			resetEnabled: false,
			zoomEnabled: false
		});
		expect(
			stageControlsFor({ status: 'failed', failure: 'missing-token', message: 'x' }, SETTLED)
				.visible
		).toBe(false);
	});

	it('shows controls but keeps Reset and zoom disabled until the mountain settles', () => {
		expect(stageControlsFor({ status: 'ready' }, MOVING)).toEqual({
			visible: true,
			resetEnabled: false,
			zoomEnabled: false
		});
	});

	it('enables Reset and zoom on a ready, settled scene', () => {
		expect(stageControlsFor({ status: 'ready' }, SETTLED)).toEqual({
			visible: true,
			resetEnabled: true,
			zoomEnabled: true
		});
	});

	it('treats degraded imagery as an ordinary ready scene', () => {
		expect(stageControlsFor({ status: 'ready', imageryDegraded: true }, SETTLED)).toEqual({
			visible: true,
			resetEnabled: true,
			zoomEnabled: true
		});
	});

	it('enables Reset and zoom on a ready scene whose camera is free', () => {
		expect(stageControlsFor({ status: 'ready' }, FREE)).toEqual({
			visible: true,
			resetEnabled: true,
			zoomEnabled: true
		});
	});

	it('keeps a free camera disabled until the scene is ready', () => {
		expect(stageControlsFor({ status: 'loading' }, FREE).zoomEnabled).toBe(false);
		expect(stageControlsFor(FAILED, FREE).visible).toBe(false);
	});
});
