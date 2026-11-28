import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeResizeObserver, type FakeViewport } from '../test/FakeResizeObserver';
import { FakeSceneFactory } from '../test/FakeSceneFactory';
import type { AtlasMarker } from './globe/atlasMarkers';
import { atlasOverviewLook, type AtlasView } from './globe/atlasView';
import type { SceneTarget } from './globe/camera';
import type { MarkerActivation } from './globe/markerActivation';
import type { SightedSummit, SummitSightings } from './globe/summitSighting';
import type { UnitSystem } from '../units/unitSystem';
import { SceneStore } from './SceneStore';
import { TransitionCoordinator } from './TransitionCoordinator';
import { StageBinding } from './StageBinding';

const ACONCAGUA: SceneTarget = {
	slug: 'aconcagua',
	name: 'Aconcagua',
	latitude: -32.653,
	longitude: -70.011,
	elevationMeters: 6961
};
const FITZ_ROY: SceneTarget = {
	slug: 'fitz-roy',
	name: 'Fitz Roy',
	latitude: -49.271,
	longitude: -73.043,
	elevationMeters: 3405
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
	FakeResizeObserver.reset();
	vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

function setup(
	options: {
		ionToken?: string;
		target?: SceneTarget;
		atlas?: AtlasView;
		markers?: readonly AtlasMarker[];
		unitSystem?: UnitSystem;
		summitMarkerVisible?: boolean;
		nearbySummits?: readonly SightedSummit[];
		onSightings?: (sightings: SummitSightings | undefined) => void;
		store?: SceneStore;
		observer?: TransitionCoordinator;
		onMarkerActivate?: (activation: MarkerActivation) => void;
		onStageResize?: () => void;
	} = {}
) {
	const factory = new FakeSceneFactory();
	const store = options.store ?? new SceneStore();
	const viewport: FakeViewport = { clientWidth: 800, clientHeight: 500 };
	const mount = () =>
		new StageBinding({
			viewport: viewport as unknown as HTMLElement,
			store,
			ionToken: 'ionToken' in options ? options.ionToken : 'ion-token',
			createScene: factory.createScene,
			target: options.target,
			atlas: options.atlas,
			markers: options.markers,
			unitSystem: options.unitSystem,
			summitMarkerVisible: options.summitMarkerVisible,
			nearbySummits: options.nearbySummits,
			onSightings: options.onSightings,
			observer: options.observer,
			onMarkerActivate: options.onMarkerActivate,
			onStageResize: options.onStageResize
		});

	return { factory, store, viewport, mount };
}

describe('StageBinding startup', () => {
	it('creates one scene for one mounted stage and observes the viewport once', () => {
		const { factory, store, viewport, mount } = setup();

		mount();

		expect(factory.calls).toHaveLength(1);
		expect(factory.calls[0]?.ionToken).toBe('ion-token');
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
		expect(FakeResizeObserver.instances).toHaveLength(1);
		expect([...(FakeResizeObserver.instances[0]?.observed ?? [])]).toEqual([viewport]);
	});

	it('hands the scene the stage size and then the target once it exists', async () => {
		const { factory, store, mount } = setup({ target: ACONCAGUA });
		mount();

		const scene = factory.resolve(0);
		await flush();

		expect(scene.stages).toEqual([{ width: 800, height: 500 }]);
		expect(scene.shown).toEqual([{ target: ACONCAGUA, placement: 'initial' }]);
		expect(store.getSnapshot().state).toMatchObject({ status: 'ready' });
	});

	it('makes no create call and reports the missing token without a provider request', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, store, mount } = setup({ ionToken: undefined });

		mount();

		expect(factory.calls).toEqual([]);
		expect(store.getSnapshot().state).toMatchObject({ status: 'failed', failure: 'missing-token' });
		expect(error).toHaveBeenCalledTimes(1);
	});

	it('reports an initialization failure through the store and the console', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, store, mount } = setup();
		mount();

		factory.reject(0, new Error('WebGL unavailable'));
		await flush();

		expect(store.getSnapshot().state).toMatchObject({
			status: 'failed',
			failure: 'initialization-failed'
		});
		expect(error).toHaveBeenCalledTimes(1);
	});
});

describe('StageBinding under Strict Mode (mount, dispose, mount)', () => {
	it('destroys a scene that resolves after its stage was disposed and never attaches it', async () => {
		const { factory, store, mount } = setup({ target: ACONCAGUA });
		const first = mount();
		first.dispose();
		const second = mount();

		const stale = factory.resolve(0);
		await flush();

		expect(factory.calls[0]?.signal.aborted).toBe(true);
		expect(stale.destroyed).toBe(true);
		expect(stale.shown).toEqual([]);
		expect(stale.stages).toEqual([]);
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		const live = factory.resolve(1);
		await flush();

		expect(live.destroyed).toBe(false);
		expect(live.shown).toEqual([{ target: ACONCAGUA, placement: 'initial' }]);
		expect(store.getSnapshot().state).toMatchObject({ status: 'ready' });
		second.dispose();
		expect(live.destroyed).toBe(true);
	});

	it('destroys the first scene before the second one exists when both had resolved', async () => {
		const { factory, mount } = setup();
		const first = mount();
		const firstScene = factory.resolve(0);
		await flush();

		first.dispose();
		mount();
		const secondScene = factory.resolve(1);
		await flush();

		expect(factory.log).toEqual(['create:1', 'destroy:1', 'create:2']);
		expect(firstScene.destroyed).toBe(true);
		expect(secondScene.destroyed).toBe(false);
		expect(firstScene.liveSubscriptions).toBe(0);
		expect(secondScene.liveSubscriptions).toBeGreaterThan(0);
	});

	it('keeps one live observer and ignores the disposed stage when its observer fires', async () => {
		const { factory, viewport, mount } = setup();
		const first = mount();
		first.dispose();
		mount();
		const scene = factory.resolve(1);
		await flush();

		viewport.clientWidth = 900;
		for (const observer of FakeResizeObserver.instances) {
			observer.fire();
		}

		const [disposed, live] = FakeResizeObserver.instances;
		expect(disposed?.disconnected).toBe(true);
		expect(live?.disconnected).toBe(false);
		expect(scene.stages).toEqual([
			{ width: 800, height: 500 },
			{ width: 900, height: 500 }
		]);
	});

	it('does not let a disposed stage overwrite the store of the current one', async () => {
		const { factory, store, mount } = setup();
		const first = mount();
		const firstScene = factory.resolve(0);
		await flush();
		first.dispose();
		const second = mount();
		const secondScene = factory.resolve(1);
		await flush();

		firstScene.emitOrientation(40);
		firstScene.emitScale({ label: '500 m', meters: 500, widthPx: 90 });
		secondScene.emitOrientation(120);

		expect(store.getSnapshot().headingDegrees).toBe(120);
		expect(store.getSnapshot().scale).toBeUndefined();
		second.dispose();
	});
});

describe('StageBinding disposal', () => {
	it('disconnects the observer, stops the session and is idempotent', async () => {
		const { factory, store, mount } = setup();
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.dispose();
		binding.dispose();

		expect(FakeResizeObserver.instances[0]?.disconnected).toBe(true);
		expect(scene.destroyCount).toBe(1);
		expect(scene.liveSubscriptions).toBe(0);
		expect(store.getSnapshot().headingDegrees).toBeUndefined();
	});

	it('does no resize or target work after disposal', async () => {
		const { factory, viewport, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();
		const stagesBefore = [...scene.stages];
		const shownBefore = scene.shown.length;

		binding.dispose();
		viewport.clientWidth = 1000;
		FakeResizeObserver.instances[0]?.fire();
		binding.setTarget(FITZ_ROY);

		expect(scene.stages).toEqual(stagesBefore);
		expect(scene.shown).toHaveLength(shownBefore);
	});

	it('cancels creation that is still pending without ever attaching the late scene', async () => {
		const { factory, store, mount } = setup({ target: ACONCAGUA });
		const binding = mount();

		binding.dispose();
		const late = factory.resolve(0);
		await flush();

		expect(factory.calls[0]?.signal.aborted).toBe(true);
		expect(late.destroyed).toBe(true);
		expect(late.shown).toEqual([]);
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
	});
});

describe('StageBinding retry', () => {
	async function failedBinding(options: Parameters<typeof setup>[0] = {}) {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const context = setup(options);
		const binding = context.mount();
		context.factory.reject(0, new Error('terrain unavailable'));
		await flush();

		return { ...context, binding };
	}

	it('creates exactly one fresh scene, shows loading again and then ready', async () => {
		const { factory, store, binding } = await failedBinding();

		binding.retry();

		expect(factory.calls).toHaveLength(2);
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
		factory.resolve(1);
		await flush();
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
		expect(factory.calls).toHaveLength(2);
	});

	it('keeps the nearby summits for the new attempt, followed once its mountain arrives', async () => {
		const elPlata = {
			slug: 'cerro-el-plata',
			latitude: -33,
			longitude: -69.5,
			elevationMeters: 5968
		};
		const ojos = {
			slug: 'ojos-del-salado',
			latitude: -27.1,
			longitude: -68.5,
			elevationMeters: 6893
		};
		const heard: (SummitSightings | undefined)[] = [];
		const { factory, binding } = await failedBinding({
			target: ACONCAGUA,
			nearbySummits: [elPlata],
			onSightings: (sightings) => heard.push(sightings)
		});
		binding.setNearbySummits([ojos]);

		binding.retry();
		const scene = factory.resolve(1);
		await flush();

		expect(scene.sightingRequests).toEqual([
			expect.objectContaining({
				presented: expect.objectContaining({ slug: 'aconcagua' }),
				nearby: [ojos]
			})
		]);
		const reading: SummitSightings = {
			viewport: { width: 800, height: 500 },
			presented: { kind: 'unknown' },
			nearby: [{ slug: 'ojos-del-salado', sighting: { kind: 'unknown' } }]
		};
		scene.emitSightings(reading);
		expect(heard).toEqual([reading]);
	});

	it('keeps the atlas for the new attempt, which opens on its overview', async () => {
		const first: AtlasView = { center: { latitude: 0, longitude: 0 } };
		const second: AtlasView = { center: { latitude: 10, longitude: 20 } };
		const { factory, binding } = await failedBinding({ atlas: first });
		binding.setAtlas(second);

		binding.retry();
		const scene = factory.resolve(1);
		await flush();

		expect(scene.overviews).toEqual([
			{ look: atlasOverviewLook(second, { width: 800, height: 500 }), animate: false }
		]);
	});

	it('presents the atlas on the new attempt, with or without markers', async () => {
		const first: AtlasView = { center: { latitude: 0, longitude: 0 } };
		const { factory, binding } = await failedBinding({ atlas: first });

		binding.retry();
		const scene = factory.resolve(1);
		await flush();

		expect(scene.presentations).toEqual([true]);
		expect(scene.markerSets).toEqual([]);
	});

	it('hands marker activations from the new attempt to the same listener, once', async () => {
		const markers: AtlasMarker[] = [
			{ slug: 'a', name: 'A', latitude: 1, longitude: 2, elevationMeters: 3 }
		];
		const onMarkerActivate = vi.fn();
		const { factory, binding } = await failedBinding({ markers, onMarkerActivate });

		binding.retry();
		const scene = factory.resolve(1);
		await flush();
		scene.activate({ kind: 'mountain', mountain: { slug: 'a', name: 'A', elevationMeters: 3000 } });

		expect(onMarkerActivate).toHaveBeenCalledOnce();
		binding.dispose();
		expect(scene.liveSubscriptions).toBe(0);
	});

	it('keeps the latest atlas markers for the new attempt', async () => {
		const first: AtlasMarker[] = [
			{ slug: 'a', name: 'A', latitude: 1, longitude: 2, elevationMeters: 3 }
		];
		const second: AtlasMarker[] = [
			{ slug: 'b', name: 'B', latitude: 4, longitude: 5, elevationMeters: 6 }
		];
		const { factory, binding } = await failedBinding({ markers: first });
		binding.setAtlasMarkers(second);

		binding.retry();
		const scene = factory.resolve(1);
		await flush();

		expect(scene.markerSets).toEqual([second]);
	});

	it('keeps the markers hidden for the new attempt without losing the atlas', async () => {
		const markers: AtlasMarker[] = [
			{ slug: 'a', name: 'A', latitude: 1, longitude: 2, elevationMeters: 3 }
		];
		const { factory, binding } = await failedBinding({
			atlas: { center: { latitude: 0, longitude: 0 } },
			markers
		});
		binding.setAtlasMarkers(undefined);

		binding.retry();
		const scene = factory.resolve(1);
		await flush();

		expect(scene.presentations).toEqual([true]);
		expect(scene.markerSets).toEqual([]);
	});

	it('keeps the mountain target and the stage size for the new attempt', async () => {
		const { factory, binding } = await failedBinding({ target: ACONCAGUA });
		binding.setTarget(FITZ_ROY);

		binding.retry();
		const scene = factory.resolve(1);
		await flush();

		expect(scene.stages).toEqual([{ width: 800, height: 500 }]);
		expect(scene.shown).toEqual([{ target: FITZ_ROY, placement: 'initial' }]);
	});

	it('keeps one observer registration', async () => {
		const { binding } = await failedBinding();

		binding.retry();

		expect(FakeResizeObserver.instances).toHaveLength(1);
		expect(FakeResizeObserver.instances[0]?.disconnected).toBe(false);
	});

	it('destroys the scene of a setup failure before the replacement is created', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, mount } = setup();
		const binding = mount();
		factory.resolve(0, { throwOn: { subscribeScale: new Error('boom') } });
		await flush();

		binding.retry();

		expect(factory.log).toEqual(['create:1', 'destroy:1', 'create:2']);
	});

	it('offers retry after the globe stops rendering and destroys the failed scene first', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, store, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		scene.failRendering(new Error('Expected width to be greater than 0, actual value was 0'));
		expect(store.getSnapshot().state).toMatchObject({ status: 'failed' });
		binding.retry();

		expect(factory.log).toEqual(['create:1', 'destroy:1', 'create:2']);
		const replacement = factory.resolve(1);
		await flush();
		scene.failRendering(new Error('stale'));
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
		expect(replacement.shown.map(({ target }) => target.slug)).toEqual(['aconcagua']);
		binding.dispose();
	});

	it('logs the render failure for development without changing the visitor state', async () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, store, mount } = setup();
		mount();
		const scene = factory.resolve(0);
		await flush();
		const failure = new Error('render failed');

		scene.failRendering(failure);

		expect(log).toHaveBeenCalledWith('Cesium scene failed', failure);
		expect(store.getSnapshot().state).toMatchObject({
			status: 'failed',
			message: 'The 3D globe could not be loaded.'
		});
	});

	it('serves a second failure and allows another retry', async () => {
		const { factory, store, binding } = await failedBinding();

		binding.retry();
		factory.reject(1, new Error('still down'));
		await flush();
		expect(store.getSnapshot().state).toMatchObject({
			status: 'failed',
			failure: 'initialization-failed'
		});
		binding.retry();
		factory.resolve(2);
		await flush();

		expect(factory.calls).toHaveLength(3);
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
	});

	it('ignores retry while an attempt is loading', () => {
		const { factory, mount } = setup();
		const binding = mount();

		binding.retry();

		expect(factory.calls).toHaveLength(1);
	});

	it('ignores retry once the stage is ready', async () => {
		const { factory, mount } = setup();
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.retry();

		expect(factory.calls).toHaveLength(1);
		expect(scene.destroyCount).toBe(0);
	});

	it('makes no provider request when retrying a missing token', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, store, mount } = setup({ ionToken: undefined });
		const binding = mount();

		binding.retry();

		expect(factory.calls).toEqual([]);
		expect(store.getSnapshot().state).toMatchObject({ failure: 'missing-token' });
	});

	it('ignores retry after disposal', async () => {
		const { factory, binding } = await failedBinding();

		binding.dispose();
		binding.retry();

		expect(factory.calls).toHaveLength(1);
	});

	it('does not let the failed attempt answer into the new one', async () => {
		const { factory, store, binding } = await failedBinding();
		binding.retry();

		factory.reject(0, new Error('late echo of the first attempt'));
		await flush();

		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
	});
});

describe('StageBinding resize', () => {
	it('publishes the stage size only when it changed', async () => {
		const { factory, viewport, mount } = setup();
		mount();
		const scene = factory.resolve(0);
		await flush();
		const observer = FakeResizeObserver.instances[0]!;

		observer.fire();
		observer.fire();
		viewport.clientHeight = 600;
		observer.fire();
		observer.fire();

		expect(scene.stages).toEqual([
			{ width: 800, height: 500 },
			{ width: 800, height: 600 }
		]);
	});

	it('keeps the latest size while the scene is still being created', async () => {
		const { factory, viewport, mount } = setup();
		mount();
		viewport.clientWidth = 640;
		viewport.clientHeight = 360;
		FakeResizeObserver.instances[0]?.fire();

		const scene = factory.resolve(0);
		await flush();

		expect(scene.stages).toEqual([{ width: 640, height: 360 }]);
	});

	it('tells its owner when the stage changes shape, not at the first measurement', async () => {
		const onStageResize = vi.fn();
		const { factory, viewport, mount } = setup({ onStageResize });
		mount();
		factory.resolve(0);
		await flush();
		const observer = FakeResizeObserver.instances[0]!;
		expect(onStageResize).not.toHaveBeenCalled();

		observer.fire();
		expect(onStageResize).not.toHaveBeenCalled();

		viewport.clientWidth = 640;
		observer.fire();
		observer.fire();
		expect(onStageResize).toHaveBeenCalledTimes(1);

		viewport.clientHeight = 300;
		observer.fire();
		expect(onStageResize).toHaveBeenCalledTimes(2);
	});

	it('registers no window resize listener', () => {
		const addEventListener = vi.fn();
		vi.stubGlobal('window', { addEventListener });
		const { mount } = setup();

		mount();

		expect(addEventListener).not.toHaveBeenCalled();
	});
});

describe('StageBinding target changes', () => {
	it('presents the next mountain on the same scene', async () => {
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.setTarget(FITZ_ROY);
		await flush();

		expect(factory.calls).toHaveLength(1);
		expect(scene.shown.map(({ target, placement }) => [target.slug, placement])).toEqual([
			['aconcagua', 'initial'],
			['fitz-roy', 'next']
		]);
	});
});

describe('StageBinding mountain orbit', () => {
	it('hands the toggle to the session, and nothing once disposed', async () => {
		const { factory, store, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.toggleMountainOrbit();
		expect(store.getSnapshot().mountainOrbit).toBe('orbiting');
		expect(scene.mountainOrbiting).toBe(true);

		binding.dispose();
		binding.toggleMountainOrbit();
		expect(scene.mountainOrbits).toHaveLength(1);
		expect(scene.mountainOrbiting).toBe(false);
	});

	it('starts a retried scene idle, with the old orbit gone with its scene', async () => {
		const { factory, store, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const failed = factory.resolve(0);
		await flush();
		vi.spyOn(console, 'error').mockImplementation(() => {});
		binding.toggleMountainOrbit();
		failed.failRendering(new Error('lost context'));
		await flush();

		binding.retry();
		const next = factory.resolve(1);
		await flush();

		expect(failed.mountainOrbiting).toBe(false);
		expect(next.mountainOrbits).toEqual([]);
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
	});
});

describe('store snapshots through the binding', () => {
	it('reach a React-style subscriber that holds subscribe and getSnapshot detached', async () => {
		const { factory, store, mount } = setup();
		const { subscribe, getSnapshot } = store;
		const heard: string[] = [];
		const unsubscribe = subscribe(() => heard.push(getSnapshot().state.status));
		mount();
		const scene = factory.resolve(0);
		await flush();

		scene.emitOrientation(30);

		// Ready, then free navigation (no target), then the heading.
		expect(heard).toEqual(['ready', 'ready', 'ready']);
		expect(getSnapshot().headingDegrees).toBe(30);

		unsubscribe();
		scene.emitOrientation(60);
		expect(heard).toHaveLength(3);
	});
});

describe('StageBinding reset', () => {
	it('is unavailable before the scene exists and after a failed initialization', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();

		expect(binding.resetView()).toBe('unavailable');

		factory.reject(0, new Error('WebGL unavailable'));
		await flush();

		expect(binding.resetView()).toBe('unavailable');
	});

	it('is unavailable until the presented mountain has arrived', async () => {
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0, { holdShow: true });
		await flush();

		expect(binding.resetView()).toBe('unavailable');
		expect(scene.resets).toBe(0);

		scene.pendingShows[0]?.resolve({ status: 'arrived' });
		await flush();

		expect(binding.resetView()).toBe('reset');
		expect(scene.resets).toBe(1);
	});

	it('returns the scene result without creating or destroying a scene', async () => {
		const { factory, store, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		scene.resetResult = 'unchanged';
		const unchanged = binding.resetView();
		scene.resetResult = 'reset';
		const reset = binding.resetView();

		expect([unchanged, reset]).toEqual(['unchanged', 'reset']);
		expect(scene.resets).toBe(2);
		expect(factory.calls).toHaveLength(1);
		expect(scene.destroyCount).toBe(0);
		expect(store.getSnapshot().state).toMatchObject({ status: 'ready' });
	});

	it('is unavailable while the next mountain is being presented', async () => {
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();
		scene.holdShow = true;

		binding.setTarget(FITZ_ROY);

		expect(binding.resetView()).toBe('unavailable');
		expect(scene.resets).toBe(0);
	});

	it('is unavailable after disposal', async () => {
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.dispose();

		expect(binding.resetView()).toBe('unavailable');
		expect(scene.resets).toBe(0);
	});
});

describe('StageBinding zoom', () => {
	it('is unavailable before the scene exists and after a failed initialization', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();

		expect(binding.zoomView('in')).toBe('unavailable');

		factory.reject(0, new Error('WebGL unavailable'));
		await flush();

		expect(binding.zoomView('out')).toBe('unavailable');
	});

	it('steps the settled scene without creating or destroying one', async () => {
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		expect([binding.zoomView('in'), binding.zoomView('out')]).toEqual(['zoomed', 'zoomed']);
		expect(scene.zooms).toEqual(['in', 'out']);
		expect(factory.calls).toHaveLength(1);
		expect(scene.destroyCount).toBe(0);
	});

	it('is unavailable after disposal', async () => {
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.dispose();

		expect(binding.zoomView('in')).toBe('unavailable');
		expect(scene.zooms).toEqual([]);
	});
});

describe('StageBinding transitions', () => {
	async function exploring() {
		const observer = new TransitionCoordinator();
		const context = setup({ target: ACONCAGUA, observer });
		const binding = context.mount();
		const scene = context.factory.resolve(0);
		await flush();
		scene.holdShow = true;
		return { ...context, observer, binding, scene };
	}

	it('arrives at a destination presented through the persistent binding', async () => {
		const { observer, binding, scene, factory } = await exploring();

		const transition = observer.begin('fitz-roy');
		binding.setTarget(FITZ_ROY);
		scene.pendingShows[0]!.resolve({ status: 'arrived' });

		await expect(transition.arrival).resolves.toBe('arrived');
		expect(factory.calls).toHaveLength(1);
		expect(scene.destroyCount).toBe(0);
	});

	it('supersedes the transition when the target changes again, keeping the scene alive', async () => {
		const { observer, binding, scene } = await exploring();

		const transition = observer.begin('fitz-roy');
		binding.setTarget(FITZ_ROY);
		binding.setTarget(ACONCAGUA);

		await expect(transition.arrival).resolves.toBe('superseded');
		expect(scene.destroyCount).toBe(0);
	});

	it('interrupts the transition when the stage is disposed', async () => {
		const { observer, binding } = await exploring();

		const transition = observer.begin('fitz-roy');
		binding.dispose();

		await expect(transition.arrival).resolves.toBe('interrupted');
	});

	it('interrupts the transition when retry replaces a failed session and presents again', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const observer = new TransitionCoordinator();
		const { factory, mount } = setup({ target: ACONCAGUA, observer });
		const binding = mount();
		factory.reject(0, new Error('WebGL unavailable'));
		await flush();

		const transition = observer.begin('fitz-roy');
		binding.retry();
		factory.resolve(1);
		await flush();

		await expect(transition.arrival).resolves.toBe('interrupted');
	});

	it('does not let a destination chosen on a failed stage hang the transition', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const observer = new TransitionCoordinator();
		const { factory, mount } = setup({ target: ACONCAGUA, observer });
		const binding = mount();
		factory.reject(0, new Error('WebGL unavailable'));
		await flush();

		const transition = observer.begin('fitz-roy');
		binding.setTarget(FITZ_ROY);

		await expect(transition.arrival).resolves.toBe('interrupted');
	});
});

describe('StageBinding atlas markers', () => {
	const MARKERS: AtlasMarker[] = [
		{ slug: 'a', name: 'A', latitude: 1, longitude: 2, elevationMeters: 3 }
	];

	it('hands the mounted markers to the scene, then each update, on the same scene', async () => {
		const { factory, mount } = setup({ markers: MARKERS });
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.setAtlasMarkers(undefined);
		binding.setAtlasMarkers([]);

		expect(scene.markerSets).toEqual([MARKERS, undefined, []]);
		expect(factory.calls).toHaveLength(1);
	});

	it('does no marker work after disposal', async () => {
		const { factory, mount } = setup();
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.dispose();
		binding.setAtlasMarkers(MARKERS);

		expect(scene.markerSets).toEqual([]);
	});
});

describe('StageBinding marker emphasis', () => {
	it('passes an emphasis to the scene, and none after disposal', async () => {
		const { factory, mount } = setup();
		const binding = mount();
		const scene = factory.resolve(0);
		await flush();

		binding.highlightMarker('a');
		binding.highlightMarker(undefined);
		binding.dispose();
		binding.highlightMarker('b');

		expect(scene.highlights).toEqual(['a', undefined]);
	});
});

describe('StageBinding framing the filtered atlas', () => {
	const STAGE = { width: 800, height: 500 };
	const OVERVIEW: AtlasView = { center: { latitude: 20, longitude: 10 } };
	const ANDES: AtlasView = {
		...OVERVIEW,
		focus: [
			{ latitude: -32.653, longitude: -70.011 },
			{ latitude: -49.271, longitude: -73.043 }
		]
	};

	async function boundAtlas(atlas: AtlasView) {
		const context = setup({ atlas });
		const binding = context.mount();
		const scene = context.factory.resolve(0);
		await flush();

		return { ...context, binding, scene };
	}

	it('flies the one live scene to the filtered places and back, without a new scene', async () => {
		const { factory, binding, scene } = await boundAtlas(OVERVIEW);

		binding.setAtlas(ANDES);
		binding.setAtlas(OVERVIEW);

		expect(scene.overviews.slice(1)).toEqual([
			{ look: atlasOverviewLook(ANDES, STAGE), animate: true },
			{ look: atlasOverviewLook(OVERVIEW, STAGE), animate: true }
		]);
		expect(factory.calls).toHaveLength(1);
	});

	it('keeps the framing for the scene a retry builds', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const context = setup({ atlas: OVERVIEW });
		const binding = context.mount();
		context.factory.reject(0, new Error('terrain unavailable'));
		await flush();
		binding.setAtlas(ANDES);

		binding.retry();
		const scene = context.factory.resolve(1);
		await flush();

		expect(scene.overviews).toEqual([{ look: atlasOverviewLook(ANDES, STAGE), animate: false }]);
		expect(scene.orbits).toEqual([]);
	});
});

describe('StageBinding unit system', () => {
	async function mounted(options: Parameters<typeof setup>[0] = {}) {
		const context = setup(options);
		const binding = context.mount();
		const scene = context.factory.resolve(0);
		await flush();

		return { ...context, binding, scene };
	}

	it('gives the scene the unit the binding was mounted with', async () => {
		const { scene } = await mounted({ unitSystem: 'imperial' });

		expect(scene.unitSystems).toEqual(['imperial']);
	});

	it('gives the scene metric when no unit was chosen', async () => {
		const { scene } = await mounted();

		expect(scene.unitSystems).toEqual(['metric']);
	});

	it('hands a change to the live scene without creating another or presenting again', async () => {
		const { factory, binding, scene } = await mounted({ target: ACONCAGUA });
		const shown = scene.shown.length;

		binding.setUnitSystem('imperial');
		binding.setUnitSystem('metric');
		binding.setUnitSystem('imperial');

		expect(scene.unitSystems).toEqual(['metric', 'imperial', 'metric', 'imperial']);
		expect(scene.shown).toHaveLength(shown);
		expect(scene.destroyCount).toBe(0);
		expect(factory.calls).toHaveLength(1);
	});

	it('holds a change made while the scene is still loading and applies it once it exists', async () => {
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();

		binding.setUnitSystem('imperial');
		const scene = factory.resolve(0);
		await flush();

		expect(scene.unitSystems).toEqual(['imperial']);
	});

	it('applies the unit chosen since mounting to the scene a retry builds', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, mount } = setup({ unitSystem: 'metric' });
		const binding = mount();
		factory.reject(0, new Error('terrain unavailable'));
		await flush();

		binding.setUnitSystem('imperial');
		binding.retry();
		const scene = factory.resolve(1);
		await flush();

		expect(scene.unitSystems).toEqual(['imperial']);
	});

	it('does nothing once disposed', async () => {
		const { binding, scene } = await mounted();
		binding.dispose();

		binding.setUnitSystem('imperial');

		expect(scene.unitSystems).toEqual(['metric']);
	});
});

describe('StageBinding summit marker visibility', () => {
	async function mounted(options: Parameters<typeof setup>[0] = {}) {
		const context = setup(options);
		const binding = context.mount();
		const scene = context.factory.resolve(0);
		await flush();

		return { ...context, binding, scene };
	}

	it('draws the summit marker unless the binding was mounted with it hidden', async () => {
		const { scene } = await mounted();
		const hidden = await mounted({ summitMarkerVisible: false });

		expect(scene.summitMarkerVisible).toBe(true);
		expect(hidden.scene.summitMarkerVisible).toBe(false);
	});

	it('hands a change to the live scene without creating another or presenting again', async () => {
		const { factory, binding, scene } = await mounted({ target: ACONCAGUA });
		const shown = scene.shown.length;

		binding.setSummitMarkerVisible(false);
		binding.setSummitMarkerVisible(true);
		binding.setSummitMarkerVisible(false);

		expect(scene.summitVisibility).toEqual([true, false, true, false]);
		expect(scene.shown).toHaveLength(shown);
		expect(scene.destroyCount).toBe(0);
		expect(factory.calls).toHaveLength(1);
	});

	it('holds a change made while the scene is still loading and applies it once it exists', async () => {
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();

		binding.setSummitMarkerVisible(false);
		const scene = factory.resolve(0);
		await flush();

		expect(scene.summitVisibility).toEqual([false]);
	});

	it('applies the choice made since mounting to the scene a retry builds', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, mount } = setup({ target: ACONCAGUA });
		const binding = mount();
		factory.reject(0, new Error('terrain unavailable'));
		await flush();

		binding.setSummitMarkerVisible(false);
		binding.retry();
		const scene = factory.resolve(1);
		await flush();

		expect(scene.summitMarkerVisible).toBe(false);
	});

	it('does nothing once disposed', async () => {
		const { binding, scene } = await mounted();
		binding.dispose();

		binding.setSummitMarkerVisible(false);

		expect(scene.summitVisibility).toEqual([true]);
	});
});
