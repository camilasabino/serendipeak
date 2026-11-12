import { afterEach, describe, expect, it, vi } from 'vitest';
import { exposeAtlasLayer, exposeCameraReading } from './e2eDiagnostics';
import type { AtlasLayerReading } from './globe/atlasMarkers';
import type { CameraReading } from './globe/cameraReading';

const READING: CameraReading = {
	headingDegrees: 66.87,
	pitchDegrees: -19.85,
	rangeMeters: 17132,
	displayRangeMeters: 18000,
	stage: { width: 900, height: 600 }
};

type Diagnostic = { __serendipeakCamera?: () => CameraReading | undefined };

const diagnostic = () =>
	(globalThis as unknown as { window: Diagnostic }).window.__serendipeakCamera;

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('exposeCameraReading', () => {
	it('publishes the reader on window and removes it on release', () => {
		vi.stubGlobal('window', {});
		const release = exposeCameraReading(() => READING);

		expect(diagnostic()?.()).toEqual(READING);

		release();

		expect(diagnostic()).toBeUndefined();
	});

	it('lets a stale release leave the reader of the current scene in place', () => {
		vi.stubGlobal('window', {});
		const releaseFirst = exposeCameraReading(() => READING);
		const releaseSecond = exposeCameraReading(() => ({ ...READING, headingDegrees: 10 }));

		releaseFirst();

		expect(diagnostic()?.()?.headingDegrees).toBe(10);

		releaseSecond();
		expect(diagnostic()).toBeUndefined();
	});
});

describe('exposeAtlasLayer', () => {
	const LAYER: AtlasLayerReading = {
		shown: true,
		layers: 1,
		entities: 0,
		depthTestAgainstTerrain: false,
		markers: []
	};
	const atlas = () =>
		(globalThis as unknown as { window: { __serendipeakAtlas?: () => unknown } }).window
			.__serendipeakAtlas;

	it('publishes the layer reader on window, and a stale release leaves the current one', () => {
		vi.stubGlobal('window', {});
		const releaseFirst = exposeAtlasLayer(() => undefined);
		const releaseSecond = exposeAtlasLayer(() => LAYER);

		releaseFirst();
		expect(atlas()?.()).toEqual(LAYER);

		releaseSecond();
		expect(atlas()).toBeUndefined();
	});
});
