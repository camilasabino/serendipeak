import { afterEach, describe, expect, it, vi } from 'vitest';
import { exposeCameraReading } from './e2eDiagnostics';
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
