import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cesium = vi.hoisted(() => ({
	viewer: undefined as unknown as FakeViewer,
	releaseLayerListener: vi.fn(),
	releaseFlight: vi.fn(),
	flightCallbacks: [] as { kind: 'glide' | 'fly'; complete(): void }[],
	holdInputs: vi.fn(),
	zooms: [] as { direction: string; durationSeconds: number }[],
	destroyLayer: vi.fn(),
	viewerError: undefined as Error | undefined,
	Ion: { defaultAccessToken: '' },
	ScreenSpaceEventType: { LEFT_CLICK: 0, LEFT_DOUBLE_CLICK: 1 },
	CameraEventType: { WHEEL: 3 },
	KeyboardEventModifier: { CTRL: 1 },
	createWorldTerrainAsync: async () => ({}),
	ImageryLayer: {
		fromWorldImagery: () => ({
			isDestroyed: () => false,
			destroy: () => cesium.destroyLayer(),
			errorEvent: { addEventListener: () => cesium.releaseLayerListener },
			readyEvent: { addEventListener: () => cesium.releaseLayerListener }
		})
	},
	IonImageryProvider: { fromAssetId: () => ({}) },
	Viewer: function Viewer() {
		if (cesium.viewerError) {
			throw cesium.viewerError;
		}
		return cesium.viewer;
	}
}));

vi.mock('cesium', () => cesium);
vi.mock('./ViewSampler', () => ({
	ViewSampler: class {
		viewHeading() {
			return Number.NaN;
		}
	}
}));
// A flight that runs until a test completes it, so a test decides when the camera is moving.
vi.mock('./ViewerCameraFlight', () => ({
	ViewerCameraFlight: class {
		release() {
			cesium.releaseFlight();
		}
		glide(_glide: unknown, { onComplete }: { onComplete(): void }) {
			cesium.flightCallbacks.push({ kind: 'glide', complete: onComplete });
		}
		fly(_move: unknown, { onComplete }: { onComplete(): void }) {
			cesium.flightCallbacks.push({ kind: 'fly', complete: onComplete });
		}
		jump() {}
		cancel() {}
		look() {
			return undefined;
		}
		holdInputs() {
			cesium.holdInputs();
		}
		zoom(direction: string, durationSeconds: number) {
			cesium.zooms.push({ direction, durationSeconds });
			return 'zoomed';
		}
		cameraReading() {
			return { headingDegrees: 10, pitchDegrees: -20, rangeMeters: 5000, displayRangeMeters: 5000 };
		}
	}
}));
vi.mock('./SummitMarkers', () => ({
	SummitMarkers: class {
		hide() {}
		show() {}
	}
}));
vi.mock('./cesiumTerrain', () => ({ createCesiumTerrainSource: () => ({}) }));

import { CesiumGlobeScene } from './CesiumGlobeScene';

interface FakeViewer {
	camera: { positionCartographic: { height: number } };
	resize(): void;
	scene: {
		imageryLayers: { remove(): void };
		screenSpaceCameraController: { zoomEventTypes: unknown };
		preUpdate: { addEventListener(listener: () => void): () => void };
	};
	screenSpaceEventHandler: { removeInputAction(type: number): void };
	isDestroyed(): boolean;
	destroy: ReturnType<typeof vi.fn>;
}

class FakeLinkElement {
	readonly sheet = {};
}

function fakeViewer(
	removeInputAction: (type: number) => void = () => {},
	removeFrameListener: () => void = () => {},
	destroyViewer: () => void = () => {}
): FakeViewer {
	let destroyed = false;
	return {
		camera: { positionCartographic: { height: 5000 } },
		resize: () => {},
		scene: {
			imageryLayers: { remove: () => {} },
			screenSpaceCameraController: { zoomEventTypes: [3] },
			preUpdate: { addEventListener: () => removeFrameListener }
		},
		screenSpaceEventHandler: { removeInputAction },
		isDestroyed: () => destroyed,
		destroy: vi.fn(() => {
			destroyed = true;
			destroyViewer();
		})
	};
}

function create(
	exposeCameraReading?: () => () => void,
	container: HTMLElement = {} as HTMLElement
): Promise<CesiumGlobeScene> {
	return CesiumGlobeScene.create(
		container,
		{ ionToken: 'token', imageryMode: 'world', exposeCameraReading },
		new AbortController().signal
	);
}

describe('CesiumGlobeScene.create after the viewer exists', () => {
	beforeEach(() => {
		vi.stubGlobal('HTMLLinkElement', FakeLinkElement);
		vi.stubGlobal('document', { getElementById: () => new FakeLinkElement() });
		vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
		cesium.releaseLayerListener.mockReset();
		cesium.releaseFlight.mockReset();
		cesium.destroyLayer.mockReset();
		cesium.viewerError = undefined;
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
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

	it('still destroys the viewer and rejects with the original error when imagery release throws', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('removeInputAction failed');
		cesium.viewer = fakeViewer(() => {
			throw failure;
		});
		cesium.releaseLayerListener.mockImplementation(() => {
			throw new Error('imagery release failed');
		});

		await expect(create()).rejects.toBe(failure);

		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		expect(cesium.viewer.isDestroyed()).toBe(true);
		expect(logged).toHaveBeenCalled();
	});

	it('runs every cleanup and keeps the original error when several of them throw', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const failure = new Error('removeInputAction failed');
		cesium.viewer = fakeViewer(
			() => {
				throw failure;
			},
			() => {},
			() => {
				throw new Error('viewer destroy failed');
			}
		);
		cesium.releaseLayerListener.mockImplementation(() => {
			throw new Error('layer listener release failed');
		});

		await expect(create()).rejects.toBe(failure);

		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		const reported = logged.mock.calls.map(([, cause]) => (cause as Error).message);
		expect(reported).toEqual(
			expect.arrayContaining(['layer listener release failed', 'viewer destroy failed'])
		);
	});

	it('does not clean up twice when the built scene owns the failure', async () => {
		const failure = new Error('expose failed');
		cesium.viewer = fakeViewer();

		await expect(
			create(() => {
				throw failure;
			})
		).rejects.toBe(failure);

		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		expect(cesium.releaseFlight).toHaveBeenCalledOnce();
	});

	describe('when the viewer constructor fails', () => {
		function container() {
			const removed: string[] = [];
			const element = {
				querySelector: (selector: string) => ({ remove: () => removed.push(selector) })
			};
			return { element: element as unknown as HTMLElement, removed };
		}

		it('releases everything and rejects with the constructor error', async () => {
			cesium.viewerError = new Error('WebGL unavailable');
			const { element, removed } = container();

			await expect(create(undefined, element)).rejects.toBe(cesium.viewerError);

			expect(cesium.releaseLayerListener).toHaveBeenCalledTimes(2);
			expect(cesium.destroyLayer).toHaveBeenCalledOnce();
			expect(removed).toEqual([':scope > .cesium-viewer', ':scope > .cesium-widget']);
		});

		it('keeps cleaning up and keeps the constructor error when a cleanup throws', async () => {
			const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
			cesium.viewerError = new Error('WebGL unavailable');
			cesium.releaseLayerListener.mockImplementation(() => {
				throw new Error('imagery release failed');
			});
			cesium.destroyLayer.mockImplementation(() => {
				throw new Error('layer destroy failed');
			});
			const { element, removed } = container();

			await expect(create(undefined, element)).rejects.toBe(cesium.viewerError);

			expect(removed).toEqual([':scope > .cesium-viewer', ':scope > .cesium-widget']);
			const reported = logged.mock.calls.map(([, cause]) => (cause as Error).message);
			expect(reported).toEqual(
				expect.arrayContaining(['imagery release failed', 'layer destroy failed'])
			);
		});
	});

	it('lets a trackpad pinch zoom alongside the default zoom bindings', async () => {
		cesium.viewer = fakeViewer();

		await create();

		expect(cesium.viewer.scene.screenSpaceCameraController.zoomEventTypes).toEqual([
			3,
			{ eventType: 3, modifier: 1 }
		]);
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

describe('CesiumGlobeScene.destroy', () => {
	beforeEach(() => {
		vi.stubGlobal('requestAnimationFrame', () => 1);
		vi.stubGlobal('cancelAnimationFrame', () => {});
		vi.stubGlobal('HTMLLinkElement', FakeLinkElement);
		vi.stubGlobal('document', { getElementById: () => new FakeLinkElement() });
		vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
		cesium.releaseLayerListener.mockReset();
		cesium.releaseFlight.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('releases the camera reading before the flight and the viewer, in that order', async () => {
		const order: string[] = [];
		cesium.viewer = fakeViewer(
			() => {},
			() => order.push('orientation'),
			() => order.push('viewer')
		);
		cesium.releaseFlight.mockImplementation(() => order.push('flight'));
		const scene = await create(() => () => order.push('reading'));
		scene.subscribeOrientation(() => {});

		scene.destroy();

		expect(order).toEqual(['reading', 'orientation', 'flight', 'viewer']);
	});

	it('still destroys the viewer when the first disposer throws', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		cesium.viewer = fakeViewer();
		const scene = await create(() => () => {
			throw new Error('reading release failed');
		});

		expect(() => scene.destroy()).not.toThrow();

		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		expect(cesium.releaseFlight).toHaveBeenCalledOnce();
		expect(cesium.releaseLayerListener).toHaveBeenCalledTimes(2);
		expect(error).toHaveBeenCalledOnce();
	});

	it('keeps releasing after the imagery listeners throw', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const orientationReleased = vi.fn();
		cesium.viewer = fakeViewer(() => {}, orientationReleased);
		cesium.releaseLayerListener.mockImplementation(() => {
			throw new Error('imagery release failed');
		});
		const scene = await create();
		scene.subscribeOrientation(() => {});

		scene.destroy();

		expect(orientationReleased).toHaveBeenCalledOnce();
		expect(cesium.releaseFlight).toHaveBeenCalledOnce();
		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalled();
	});

	it('keeps releasing after the orientation tracker throws', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		cesium.viewer = fakeViewer(
			() => {},
			() => {
				throw new Error('frame listener removal failed');
			}
		);
		const scene = await create();
		scene.subscribeOrientation(() => {});

		scene.destroy();

		expect(cesium.releaseFlight).toHaveBeenCalledOnce();
		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledOnce();
	});

	it('destroys the viewer when the camera flight release throws', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		cesium.viewer = fakeViewer();
		cesium.releaseFlight.mockImplementation(() => {
			throw new Error('flight release failed');
		});
		const scene = await create();

		scene.destroy();

		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
		expect(error).toHaveBeenCalledOnce();
	});

	it('reports every failing disposer and does not rethrow', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		cesium.viewer = fakeViewer(
			() => {},
			() => {
				throw new Error('orientation');
			},
			() => {
				throw new Error('viewer');
			}
		);
		cesium.releaseFlight.mockImplementation(() => {
			throw new Error('flight');
		});
		const scene = await create(() => () => {
			throw new Error('reading');
		});
		scene.subscribeOrientation(() => {});

		expect(() => scene.destroy()).not.toThrow();

		const reported = error.mock.calls.map(([, cause]) => (cause as Error).message);
		expect(reported).toEqual(['reading', 'orientation', 'flight', 'viewer']);
	});

	it('runs each disposer once when destroyed again after a failure', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		cesium.viewer = fakeViewer();
		cesium.releaseFlight.mockImplementation(() => {
			throw new Error('flight release failed');
		});
		const scene = await create();

		scene.destroy();
		scene.destroy();

		expect(cesium.releaseFlight).toHaveBeenCalledOnce();
		expect(cesium.viewer.destroy).toHaveBeenCalledOnce();
	});
});

describe('CesiumGlobeScene camera reads and zoom steps', () => {
	const TARGET = {
		slug: 'aconcagua',
		name: 'Aconcagua',
		latitude: -32.65,
		longitude: -70.01,
		elevationMeters: 6961,
		camera: {
			headingDegrees: 66.87,
			pitchDegrees: -18,
			rangeMeters: 4321,
			framing: { x: 0.1, y: -0.2 }
		}
	};

	beforeEach(() => {
		vi.stubGlobal('HTMLLinkElement', FakeLinkElement);
		vi.stubGlobal('document', { getElementById: () => new FakeLinkElement() });
		vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
		cesium.flightCallbacks.length = 0;
		cesium.holdInputs.mockReset();
		cesium.zooms.length = 0;
		cesium.viewer = fakeViewer();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	async function sceneWithMountain(): Promise<CesiumGlobeScene> {
		const scene = await create(undefined, { clientWidth: 1280, clientHeight: 800 } as HTMLElement);
		const arrival = scene.showMountain(TARGET, 'initial');
		await vi.waitFor(() => expect(cesium.flightCallbacks).toHaveLength(1));
		cesium.flightCallbacks.shift()!.complete();
		await arrival;

		return scene;
	}

	it('gives no pose while the reveal is still flying', async () => {
		const scene = await create(undefined, { clientWidth: 1280, clientHeight: 800 } as HTMLElement);
		const arrival = scene.showMountain(TARGET, 'initial');
		await vi.waitFor(() => expect(cesium.flightCallbacks).toHaveLength(1));

		expect(scene.readCamera()).toBeUndefined();

		cesium.flightCallbacks.shift()!.complete();
		await arrival;
		expect(scene.readCamera()).toBeDefined();
	});

	it('gives the pose once the mountain has been reached', async () => {
		const scene = await sceneWithMountain();

		expect(scene.readCamera()).toMatchObject({ headingDegrees: 10, rangeMeters: 5000 });
	});

	it('gives no pose while a restore is flying, and gives it again when the flight ends', async () => {
		const scene = await sceneWithMountain();

		expect(scene.resetView()).toBe('reset');
		expect(cesium.flightCallbacks).toEqual([expect.objectContaining({ kind: 'fly' })]);
		expect(scene.readCamera()).toBeUndefined();

		cesium.flightCallbacks.shift()!.complete();
		expect(scene.readCamera()).toBeDefined();
	});

	it('refuses a zoom step while the reveal or a restore owns the camera', async () => {
		const scene = await create(undefined, { clientWidth: 1280, clientHeight: 800 } as HTMLElement);
		const arrival = scene.showMountain(TARGET, 'initial');
		await vi.waitFor(() => expect(cesium.flightCallbacks).toHaveLength(1));

		expect(scene.zoomView('in')).toBe('unavailable');

		cesium.flightCallbacks.shift()!.complete();
		await arrival;
		expect(scene.resetView()).toBe('reset');
		expect(scene.zoomView('out')).toBe('unavailable');

		cesium.flightCallbacks.shift()!.complete();
		expect(scene.zoomView('out')).toBe('zoomed');
		expect(cesium.zooms).toEqual([{ direction: 'out', durationSeconds: 0.5 }]);
	});

	it('steps instantly under reduced motion', async () => {
		vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
		const scene = await create();

		expect(scene.zoomView('in')).toBe('zoomed');
		expect(cesium.zooms).toEqual([{ direction: 'in', durationSeconds: 0 }]);
	});

	it('refuses a zoom step once the scene is destroyed', async () => {
		const scene = await sceneWithMountain();

		scene.destroy();

		expect(scene.zoomView('in')).toBe('unavailable');
		expect(cesium.zooms).toEqual([]);
	});

	it('gives no pose once the scene is destroyed', async () => {
		const scene = await sceneWithMountain();

		scene.destroy();

		expect(scene.readCamera()).toBeUndefined();
	});
});
