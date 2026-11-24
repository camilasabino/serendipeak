import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const cesium = vi.hoisted(() => ({
	viewer: undefined as unknown as FakeViewer,
	releaseLayerListener: vi.fn(),
	releaseFlight: vi.fn(),
	releaseAtlas: vi.fn(),
	releasePicker: vi.fn(),
	releaseLook: vi.fn(),
	lookStates: [] as boolean[],
	pickerListeners: [] as unknown[],
	atlasSets: [] as unknown[],
	flightCallbacks: [] as { kind: 'glide' | 'fly' | 'view'; complete(): void }[],
	flightCancels: 0,
	placedLooks: [] as unknown[],
	holdInputs: vi.fn(),
	orbits: [] as { periodSeconds: number; running: boolean }[],
	adopts: 0,
	ranges: [] as number[],
	rangeResult: true,
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
		flyToLook(_look: unknown, _durationSeconds: number, { onComplete }: { onComplete(): void }) {
			cesium.flightCallbacks.push({ kind: 'view', complete: onComplete });
			return true;
		}
		applyLook(look: unknown) {
			cesium.placedLooks.push(look);
			return true;
		}
		jump() {}
		cancel() {
			cesium.flightCancels += 1;
		}
		setRange(rangeMeters: number) {
			cesium.ranges.push(rangeMeters);
			return cesium.rangeResult;
		}
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
	COMPACT_STAGE_QUERY: '(max-width: 55.99rem)',
	SummitMarkers: class {
		hide() {}
		show() {}
	}
}));
vi.mock('./AtlasMarkers', () => ({
	AtlasMarkers: class {
		set(markers: unknown) {
			cesium.atlasSets.push(markers);
		}
		read() {
			return { shown: cesium.atlasSets.at(-1) !== undefined };
		}
		release() {
			cesium.releaseAtlas();
		}
	}
}));
vi.mock('./AtlasLook', () => ({
	AtlasLook: class {
		setActive(active: boolean) {
			cesium.lookStates.push(active);
		}
		read() {
			return { intensity: 0 };
		}
		release() {
			cesium.releaseLook();
		}
	}
}));
vi.mock('./AtlasPicker', () => ({
	AtlasPicker: class {
		subscribe(listener: unknown) {
			cesium.pickerListeners.push(listener);
			return () => {
				cesium.pickerListeners.splice(cesium.pickerListeners.indexOf(listener), 1);
			};
		}
		refreshed() {}
		release() {
			cesium.releasePicker();
			cesium.pickerListeners.length = 0;
		}
	}
}));
vi.mock('./ViewerOrbit', () => ({
	ViewerOrbit: class {
		start(periodSeconds: number) {
			this.stop();
			cesium.orbits.push({ periodSeconds, running: true });
			return true;
		}
		stop() {
			for (const orbit of cesium.orbits) {
				orbit.running = false;
			}
		}
		adopt() {
			cesium.adopts += 1;
		}
		get running() {
			return cesium.orbits.some((orbit) => orbit.running);
		}
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
		renderError: {
			addEventListener(listener: (scene: unknown, error: unknown) => void): () => void;
		};
		canvas: EventTarget;
	};
	/** Cesium raising its renderError event, as its render loop does when a frame throws. */
	raiseRenderError(error: unknown): void;
	screenSpaceEventHandler: { removeInputAction(type: number): void };
	isDestroyed(): boolean;
	destroy: ReturnType<typeof vi.fn>;
}

interface AntialiasingProbe {
	msaaSamples: number;
	postProcessStages: { fxaa: { enabled: boolean } };
	canvas: EventTarget;
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
	const renderErrorListeners = new Set<(scene: unknown, error: unknown) => void>();
	return {
		camera: { positionCartographic: { height: 5000 } },
		resize: () => {},
		scene: {
			imageryLayers: { remove: () => {} },
			screenSpaceCameraController: { zoomEventTypes: [3] },
			preUpdate: { addEventListener: () => removeFrameListener },
			renderError: {
				addEventListener: (listener) => {
					renderErrorListeners.add(listener);
					return () => renderErrorListeners.delete(listener);
				}
			},
			canvas: new EventTarget()
		},
		raiseRenderError: (error) => {
			for (const listener of [...renderErrorListeners]) {
				listener({}, error);
			}
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

	it('swaps MSAA for FXAA when the context reports an Adreno 830', async () => {
		cesium.viewer = fakeViewer();
		const scene = cesium.viewer.scene as unknown as AntialiasingProbe;
		scene.msaaSamples = 4;
		scene.postProcessStages = { fxaa: { enabled: false } };
		scene.canvas = Object.assign(new EventTarget(), {
			getContext: () => ({
				getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }),
				getParameter: () => 'ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)'
			})
		});

		await create();

		expect(scene.msaaSamples).toBe(1);
		expect(scene.postProcessStages.fxaa.enabled).toBe(true);
	});

	it('leaves MSAA and FXAA alone on any other renderer', async () => {
		cesium.viewer = fakeViewer();
		const scene = cesium.viewer.scene as unknown as AntialiasingProbe;
		scene.msaaSamples = 4;
		scene.postProcessStages = { fxaa: { enabled: false } };
		scene.canvas = Object.assign(new EventTarget(), {
			getContext: () => ({
				getExtension: () => ({ UNMASKED_RENDERER_WEBGL: 1 }),
				getParameter: () => 'ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)'
			})
		});

		await create();

		expect(scene.msaaSamples).toBe(4);
		expect(scene.postProcessStages.fxaa.enabled).toBe(false);
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

	it('releases the atlas picker, markers and reading before the viewer', async () => {
		const order: string[] = [];
		cesium.viewer = fakeViewer(
			() => {},
			() => {},
			() => order.push('viewer')
		);
		cesium.releaseAtlas.mockImplementation(() => order.push('atlas markers'));
		cesium.releasePicker.mockImplementation(() => order.push('atlas picker'));
		const scene = await CesiumGlobeScene.create(
			{} as HTMLElement,
			{
				ionToken: 'token',
				imageryMode: 'world',
				exposeAtlasLayer: () => () => order.push('atlas reading')
			},
			new AbortController().signal
		);

		scene.destroy();
		scene.destroy();

		expect(order).toEqual(['atlas reading', 'atlas picker', 'atlas markers', 'viewer']);
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

	it('holds direct input while a restore flies', async () => {
		const scene = await sceneWithMountain();

		expect(scene.resetView()).toBe('reset');

		expect(cesium.flightCallbacks).toEqual([expect.objectContaining({ kind: 'fly' })]);
		expect(cesium.holdInputs).toHaveBeenCalledOnce();
	});

	it('leaves direct input free after an instant restore under reduced motion', async () => {
		const motion = { matches: false };
		vi.stubGlobal('window', { matchMedia: () => motion });
		const scene = await sceneWithMountain();
		motion.matches = true;

		expect(scene.resetView()).toBe('reset');

		expect(cesium.flightCallbacks).toEqual([]);
		expect(cesium.holdInputs).not.toHaveBeenCalled();
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

describe('CesiumGlobeScene ambient orbit', () => {
	beforeEach(() => {
		vi.stubGlobal('HTMLLinkElement', FakeLinkElement);
		vi.stubGlobal('document', { getElementById: () => new FakeLinkElement() });
		vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
		cesium.flightCallbacks.length = 0;
		cesium.orbits.length = 0;
		cesium.adopts = 0;
		cesium.ranges.length = 0;
		cesium.rangeResult = true;
		cesium.viewer = fakeViewer();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	const TARGET = { slug: 'peak', name: 'Peak', latitude: 1, longitude: 2, elevationMeters: 3000 };

	it('starts only while no choreography owns the camera, and every flight stops it', async () => {
		const scene = await create(undefined, { clientWidth: 1280, clientHeight: 800 } as HTMLElement);
		expect(scene.startOrbit(300, () => {})).toBe(true);

		void scene.showMountain(TARGET, 'initial');
		await vi.waitFor(() => expect(cesium.flightCallbacks).toHaveLength(1));

		expect(cesium.orbits.every((orbit) => !orbit.running)).toBe(true);
		expect(scene.startOrbit(300, () => {})).toBe(false);
	});

	it('refits the range of a free camera and lets the orbit carry on from there', async () => {
		const scene = await create();
		scene.startOrbit(300, () => {});

		expect(scene.refitRange(12_000_000)).toBe('refitted');

		expect(cesium.ranges).toEqual([12_000_000]);
		expect(cesium.adopts).toBe(1);
		expect(cesium.orbits.filter((orbit) => orbit.running)).toHaveLength(1);
	});

	it('leaves the range alone while a flight owns the camera', async () => {
		const scene = await create();
		void scene.showMountain(TARGET, 'initial');
		await vi.waitFor(() => expect(cesium.flightCallbacks).toHaveLength(1));

		expect(scene.refitRange(12_000_000)).toBe('busy');

		expect(cesium.ranges).toEqual([]);
		expect(cesium.adopts).toBe(0);
	});

	it('reports a camera that cannot be placed without adopting the move', async () => {
		const scene = await create();
		cesium.rangeResult = false;

		expect(scene.refitRange(12_000_000)).toBe('unavailable');

		expect(cesium.adopts).toBe(0);
	});

	it('refits nothing once destroyed', async () => {
		const scene = await create();
		scene.destroy();

		expect(scene.refitRange(12_000_000)).toBe('unavailable');

		expect(cesium.ranges).toEqual([]);
	});

	it('cannot turn under reduced motion', async () => {
		vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
		const scene = await create();

		expect(scene.canOrbit()).toBe(false);
	});

	it('hands atlas markers to their layer, and nothing once destroyed', async () => {
		cesium.atlasSets.length = 0;
		const scene = await create();
		const markers = [
			{ slug: 'a', name: 'A', latitude: 1, longitude: 2, elevationMeters: 3 }
		] as const;

		scene.setAtlasMarkers(markers);
		scene.setAtlasMarkers(undefined);
		scene.destroy();
		scene.setAtlasMarkers(markers);

		expect(cesium.atlasSets).toEqual([markers, undefined]);
	});

	it('hands the atlas presentation to its look, and nothing once destroyed', async () => {
		cesium.lookStates.length = 0;
		const scene = await create();

		scene.setAtlasPresentation(true);
		scene.setAtlasPresentation(false);
		scene.destroy();
		scene.setAtlasPresentation(true);

		expect(cesium.lookStates).toEqual([true, false]);
	});

	it('releases the atlas look and its reading before the viewer, once', async () => {
		const order: string[] = [];
		cesium.viewer = fakeViewer(
			() => {},
			() => {},
			() => order.push('viewer')
		);
		cesium.releaseLook.mockImplementation(() => order.push('atlas look'));
		const scene = await CesiumGlobeScene.create(
			{} as HTMLElement,
			{
				ionToken: 'token',
				imageryMode: 'world',
				exposeAtlasLook: () => () => order.push('look reading')
			},
			new AbortController().signal
		);

		scene.destroy();
		scene.destroy();

		expect(order).toEqual(['look reading', 'atlas look', 'viewer']);
	});

	it('hands marker activation to the picker, one listener at a time, and none once destroyed', async () => {
		cesium.pickerListeners.length = 0;
		const scene = await create();
		const first = vi.fn();
		const second = vi.fn();

		const releaseFirst = scene.subscribeMarkerActivation(first);
		releaseFirst();
		scene.subscribeMarkerActivation(second);
		expect(cesium.pickerListeners).toEqual([second]);

		scene.destroy();
		expect(cesium.pickerListeners).toEqual([]);
		scene.subscribeMarkerActivation(first);
		expect(cesium.pickerListeners).toEqual([]);
	});

	it('hears presses and wheels on the globe until released or destroyed', async () => {
		const scene = await create();
		const heard = vi.fn();
		const release = scene.subscribeInteraction(heard);
		const canvas = cesium.viewer.scene.canvas;

		canvas.dispatchEvent(new Event('pointerdown'));
		canvas.dispatchEvent(new Event('wheel'));
		expect(heard).toHaveBeenCalledTimes(2);

		release();
		canvas.dispatchEvent(new Event('pointerdown'));
		expect(heard).toHaveBeenCalledTimes(2);

		scene.subscribeInteraction(heard);
		scene.startOrbit(300, () => {});
		scene.destroy();
		canvas.dispatchEvent(new Event('wheel'));
		expect(heard).toHaveBeenCalledTimes(2);
		expect(cesium.orbits.every((orbit) => !orbit.running)).toBe(true);
		expect(scene.canOrbit()).toBe(false);
	});
});

describe('CesiumGlobeScene render failures', () => {
	const settle = () => Promise.resolve();

	beforeEach(() => {
		vi.stubGlobal('requestAnimationFrame', () => 1);
		vi.stubGlobal('cancelAnimationFrame', () => {});
		vi.stubGlobal('HTMLLinkElement', FakeLinkElement);
		vi.stubGlobal('document', { getElementById: () => new FakeLinkElement() });
		vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
		cesium.viewer = fakeViewer();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('reports a render loop error after the failing frame has returned', async () => {
		const scene = await create();
		const failed = vi.fn();
		const failure = new Error('Expected width to be greater than 0, actual value was 0');
		scene.subscribeFailure(failed);

		cesium.viewer.raiseRenderError(failure);
		expect(failed).not.toHaveBeenCalled();
		await settle();

		expect(failed).toHaveBeenCalledExactlyOnceWith(failure);
		expect(cesium.viewer.destroy).not.toHaveBeenCalled();
	});

	it('reports only the first of several render errors', async () => {
		const scene = await create();
		const failed = vi.fn();
		scene.subscribeFailure(failed);
		const first = new Error('first');

		cesium.viewer.raiseRenderError(first);
		cesium.viewer.raiseRenderError(new Error('second'));
		await settle();
		cesium.viewer.raiseRenderError(new Error('third'));
		await settle();

		expect(failed).toHaveBeenCalledExactlyOnceWith(first);
	});

	it('reports nothing once released, replaced or destroyed', async () => {
		const scene = await create();
		const released = vi.fn();
		const replaced = vi.fn();
		const current = vi.fn();
		scene.subscribeFailure(released)();
		scene.subscribeFailure(replaced);
		scene.subscribeFailure(current);

		cesium.viewer.raiseRenderError(new Error('boom'));
		await settle();
		expect(released).not.toHaveBeenCalled();
		expect(replaced).not.toHaveBeenCalled();
		expect(current).toHaveBeenCalledOnce();
	});

	it('drops an error that was already on its way when the scene is destroyed', async () => {
		const scene = await create();
		const failed = vi.fn();
		scene.subscribeFailure(failed);

		cesium.viewer.raiseRenderError(new Error('boom'));
		scene.destroy();
		await settle();
		cesium.viewer.raiseRenderError(new Error('late'));
		await settle();

		expect(failed).not.toHaveBeenCalled();
		expect(scene.subscribeFailure(failed)).toBeTypeOf('function');
		cesium.viewer.raiseRenderError(new Error('after'));
		await settle();
		expect(failed).not.toHaveBeenCalled();
	});
});

describe('CesiumGlobeScene overview flights', () => {
	const LOOK = {
		latitude: -35,
		longitude: -68,
		altitudeMeters: 0,
		headingDegrees: 0,
		pitchDegrees: -89,
		rangeMeters: 3_000_000,
		framingX: 0,
		framingY: 0
	};

	beforeEach(() => {
		vi.stubGlobal('HTMLLinkElement', FakeLinkElement);
		vi.stubGlobal('document', { getElementById: () => new FakeLinkElement() });
		vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
		cesium.flightCallbacks.length = 0;
		cesium.flightCancels = 0;
		cesium.placedLooks.length = 0;
		cesium.holdInputs.mockReset();
		cesium.viewer = fakeViewer();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	it('flies to a look and leaves direct input free, unlike a restore', async () => {
		const scene = await create();

		const arrival = scene.showOverview(LOOK, true);
		expect(cesium.flightCallbacks).toEqual([expect.objectContaining({ kind: 'view' })]);
		expect(cesium.holdInputs).not.toHaveBeenCalled();

		cesium.flightCallbacks.shift()!.complete();
		await expect(arrival).resolves.toEqual({ status: 'arrived' });
	});

	it('gives way to the first press on the globe, which ends the flight as interrupted', async () => {
		const scene = await create();
		const heard = vi.fn();
		scene.subscribeInteraction(heard);
		const arrival = scene.showOverview(LOOK, true);

		cesium.viewer.scene.canvas.dispatchEvent(new Event('pointerdown'));

		await expect(arrival).resolves.toEqual({ status: 'interrupted' });
		expect(cesium.flightCancels).toBe(1);
		expect(heard).toHaveBeenCalledOnce();
	});

	it('gives way to a wheel as well, and cancels a flight only once', async () => {
		const scene = await create();
		scene.subscribeInteraction(() => {});
		const arrival = scene.showOverview(LOOK, true);

		cesium.viewer.scene.canvas.dispatchEvent(new Event('wheel'));
		cesium.viewer.scene.canvas.dispatchEvent(new Event('wheel'));

		await expect(arrival).resolves.toEqual({ status: 'interrupted' });
		expect(cesium.flightCancels).toBe(1);
	});

	it('does not cancel a flight that has arrived when a press comes later', async () => {
		const scene = await create();
		scene.subscribeInteraction(() => {});
		const arrival = scene.showOverview(LOOK, true);
		cesium.flightCallbacks.shift()!.complete();
		await arrival;

		cesium.viewer.scene.canvas.dispatchEvent(new Event('pointerdown'));

		expect(cesium.flightCancels).toBe(0);
	});

	it('does not cancel a flight to a mountain, which the reader cannot interrupt this way', async () => {
		const scene = await create(undefined, { clientWidth: 1280, clientHeight: 800 } as HTMLElement);
		scene.subscribeInteraction(() => {});
		void scene.showOverview(LOOK, true);
		void scene.showMountain(
			{ slug: 'peak', name: 'Peak', latitude: 1, longitude: 2, elevationMeters: 3000 },
			'initial'
		);
		await vi.waitFor(() => expect(cesium.flightCallbacks).toHaveLength(2));
		const cancelled = cesium.flightCancels;

		cesium.viewer.scene.canvas.dispatchEvent(new Event('pointerdown'));

		expect(cesium.flightCancels).toBe(cancelled);
	});

	it('supersedes a flight in the air with the next one', async () => {
		const scene = await create();
		const first = scene.showOverview(LOOK, true);

		const second = scene.showOverview({ ...LOOK, longitude: 10 }, true);

		await expect(first).resolves.toEqual({ status: 'interrupted' });
		cesium.flightCallbacks.pop()!.complete();
		await expect(second).resolves.toEqual({ status: 'arrived' });
	});

	it('places the look at once, with no flight, when the reader prefers reduced motion', async () => {
		vi.stubGlobal('window', { matchMedia: () => ({ matches: true }) });
		const scene = await create();

		const arrival = scene.showOverview(LOOK, true);

		expect(cesium.flightCallbacks).toEqual([]);
		expect(cesium.placedLooks).toEqual([LOOK]);
		await expect(arrival).resolves.toEqual({ status: 'arrived' });
	});
});
