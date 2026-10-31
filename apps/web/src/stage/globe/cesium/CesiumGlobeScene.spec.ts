import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cesium = vi.hoisted(() => ({
	viewer: undefined as unknown as FakeViewer,
	releaseLayerListener: vi.fn(),
	Ion: { defaultAccessToken: '' },
	ScreenSpaceEventType: { LEFT_CLICK: 0, LEFT_DOUBLE_CLICK: 1 },
	createWorldTerrainAsync: async () => ({}),
	ImageryLayer: {
		fromWorldImagery: () => ({
			errorEvent: { addEventListener: () => cesium.releaseLayerListener },
			readyEvent: { addEventListener: () => cesium.releaseLayerListener }
		})
	},
	IonImageryProvider: { fromAssetId: () => ({}) },
	Viewer: function Viewer() {
		return cesium.viewer;
	}
}));

vi.mock('cesium', () => cesium);
vi.mock('./ViewSampler', () => ({ ViewSampler: class {} }));
vi.mock('./ViewerCameraFlight', () => ({
	ViewerCameraFlight: class {
		release() {}
	}
}));
vi.mock('./SummitMarkers', () => ({
	SummitMarkers: class {
		hide() {}
	}
}));
vi.mock('./cesiumTerrain', () => ({ createCesiumTerrainSource: () => ({}) }));

import { CesiumGlobeScene } from './CesiumGlobeScene';

interface FakeViewer {
	scene: { imageryLayers: { remove(): void } };
	screenSpaceEventHandler: { removeInputAction(type: number): void };
	isDestroyed(): boolean;
	destroy: ReturnType<typeof vi.fn>;
}

class FakeLinkElement {
	readonly sheet = {};
}

function fakeViewer(removeInputAction: (type: number) => void = () => {}): FakeViewer {
	let destroyed = false;
	return {
		scene: { imageryLayers: { remove: () => {} } },
		screenSpaceEventHandler: { removeInputAction },
		isDestroyed: () => destroyed,
		destroy: vi.fn(() => {
			destroyed = true;
		})
	};
}

function create(exposeCameraReading?: () => () => void): Promise<CesiumGlobeScene> {
	return CesiumGlobeScene.create(
		{} as HTMLElement,
		{ ionToken: 'token', imageryMode: 'world', exposeCameraReading },
		new AbortController().signal
	);
}

describe('CesiumGlobeScene.create after the viewer exists', () => {
	beforeEach(() => {
		vi.stubGlobal('HTMLLinkElement', FakeLinkElement);
		vi.stubGlobal('document', { getElementById: () => new FakeLinkElement() });
		vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
		cesium.releaseLayerListener.mockClear();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it('destroys the viewer and rethrows when entity picking setup fails', async () => {
		const failure = new Error('removeInputAction failed');
		cesium.viewer = fakeViewer(() => {
			throw failure;
		});

		await expect(create()).rejects.toBe(failure);
		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		expect(cesium.releaseLayerListener).toHaveBeenCalledTimes(2);
	});

	it('destroys the built scene and rethrows when exposing the camera reading fails', async () => {
		const failure = new Error('expose failed');
		cesium.viewer = fakeViewer();

		await expect(
			create(() => {
				throw failure;
			})
		).rejects.toBe(failure);
		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		expect(cesium.releaseLayerListener).toHaveBeenCalledTimes(2);
	});

	it('keeps the viewer alive when initialization succeeds', async () => {
		cesium.viewer = fakeViewer();

		const scene = await create();

		expect(cesium.viewer.destroy).not.toHaveBeenCalled();
		expect(cesium.releaseLayerListener).not.toHaveBeenCalled();
		scene.destroy();
		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
	});
});
