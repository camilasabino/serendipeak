import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidImageryModeError } from './globe/imagery';

const create = vi.hoisted(() => vi.fn());

vi.mock('./globe/cesium/CesiumGlobeScene', () => ({ CesiumGlobeScene: { create } }));

import { cesiumSceneFactory } from './cesiumSceneFactory';

const ELEMENTS = {
	stage: { name: 'stage' } as unknown as HTMLElement,
	viewport: { name: 'viewport' } as unknown as HTMLElement
};

beforeEach(() => {
	create.mockReset();
	create.mockResolvedValue({ name: 'scene' });
});

function createScene(config: Parameters<typeof cesiumSceneFactory>[0]) {
	return cesiumSceneFactory(config)(ELEMENTS);
}

describe('cesiumSceneFactory', () => {
	it('creates the scene in the viewport, with the stage as fullscreen element, token and signal', async () => {
		const signal = new AbortController().signal;

		await createScene({ isDevelopment: false, imageryMode: null })('ion-token', signal);

		expect(create).toHaveBeenCalledTimes(1);
		expect(create).toHaveBeenCalledWith(
			ELEMENTS.viewport,
			ELEMENTS.stage,
			expect.objectContaining({ ionToken: 'ion-token' }),
			signal
		);
	});

	it.each([
		['production default', false, null, 'world'],
		['development default', true, null, 'sentinel2'],
		['explicit mode in production', false, 'sentinel2', 'sentinel2'],
		['explicit none in development', true, 'none', 'none']
	])('resolves the imagery mode: %s', async (_name, isDevelopment, configured, expected) => {
		await createScene({ isDevelopment, imageryMode: configured })(
			'ion-token',
			new AbortController().signal
		);

		expect(create.mock.calls[0]?.[2]).toMatchObject({ imageryMode: expected });
	});

	it('rejects an invalid imagery mode before any scene is created', async () => {
		const attempt = createScene({ isDevelopment: false, imageryMode: 'satellite' })(
			'ion-token',
			new AbortController().signal
		);

		await expect(attempt).rejects.toBeInstanceOf(InvalidImageryModeError);
		expect(create).not.toHaveBeenCalled();
	});

	it('does not expose camera diagnostics unless the build flag is set', async () => {
		await createScene({ isDevelopment: false, imageryMode: null })(
			'ion-token',
			new AbortController().signal
		);

		expect(create.mock.calls[0]?.[2].exposeCameraReading).toBeUndefined();
	});
});
