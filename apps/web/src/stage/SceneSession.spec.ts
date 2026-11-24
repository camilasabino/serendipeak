import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeReleaseStep, FakeSetupStep } from '../test/FakeGlobeScene';
import { FakeSceneFactory } from '../test/FakeSceneFactory';
import {
	ATLAS_ORBIT_PERIOD_SECONDS,
	ATLAS_VIEW,
	atlasOverviewLook,
	overviewRangeMeters,
	type AtlasView
} from './globe/atlasView';
import type { AtlasMarker } from './globe/atlasMarkers';
import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import { MOUNTAIN_ORBIT_PERIOD_SECONDS } from './globe/mountainOrbit';
import {
	SceneSession,
	type PresentationObserver,
	type PresentationOutcome,
	type SceneSessionOptions
} from './SceneSession';
import { SceneStore } from './SceneStore';
import { TransitionCoordinator } from './TransitionCoordinator';

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

const READING: CameraReading = {
	headingDegrees: 120,
	pitchDegrees: -20,
	rangeMeters: 12_000,
	framing: { x: 0.1, y: -0.2 },
	displayRangeMeters: 12_500,
	stage: { width: 800, height: 600 }
};

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup(overrides: Partial<SceneSessionOptions> = {}, store = new SceneStore()) {
	const factory = new FakeSceneFactory();
	const open = (more: Partial<SceneSessionOptions> = {}) =>
		new SceneSession({
			ionToken: 'ion-token',
			createScene: factory.createScene,
			store,
			...overrides,
			...more
		});
	return { factory, store, open, session: open() };
}

async function readySession(sceneOptions = {}) {
	const context = setup();
	const scene = context.factory.resolve(0, sceneOptions);
	await flush();
	return { ...context, scene };
}

describe('SceneSession startup', () => {
	it('reports loading, then ready once the scene exists', async () => {
		const { store, factory } = setup();
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		factory.resolve(0);
		await flush();

		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
	});

	it.each([undefined, '', '   '])('makes no create call for the token %j', (ionToken) => {
		const { store, factory, session } = setup({ ionToken });

		session.setTarget(ACONCAGUA);
		session.updateStage({ width: 800, height: 600 });

		expect(factory.calls).toEqual([]);
		expect(store.getSnapshot().state).toMatchObject({ status: 'failed', failure: 'missing-token' });
		expect(session.resetView()).toBe('unavailable');
		expect(() => session.stop()).not.toThrow();
	});

	it('passes the trimmed token and an unaborted signal to create', () => {
		const { factory } = setup({ ionToken: '  secret  ' });

		expect(factory.calls[0]?.ionToken).toBe('secret');
		expect(factory.calls[0]?.signal.aborted).toBe(false);
	});

	it('reports an initialization failure without leaking the token', async () => {
		const onError = vi.fn();
		const { store, factory } = setup({ onError });
		const error = new Error('WebGL unavailable for ion-token');

		factory.reject(0, error);
		await flush();

		const state = store.getSnapshot().state;
		expect(state).toEqual({
			status: 'failed',
			failure: 'initialization-failed',
			message: 'The 3D globe could not be loaded.'
		});
		expect(JSON.stringify(state)).not.toContain('ion-token');
		expect(onError).toHaveBeenCalledWith(error);
	});

	it('reports a synchronous create throw as an initialization failure', async () => {
		const { store } = setup({
			createScene: () => {
				throw new Error('factory bug');
			}
		});
		await flush();

		expect(store.getSnapshot().state).toMatchObject({
			status: 'failed',
			failure: 'initialization-failed'
		});
	});

	it('ignores a failure that arrives after stop', async () => {
		const onError = vi.fn();
		const { store, factory, session } = setup({ onError });

		session.stop();
		factory.reject(0, new Error('late'));
		await flush();

		expect(onError).not.toHaveBeenCalled();
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
	});

	it('lets a new session recover after an earlier one failed', async () => {
		const { store, factory, open } = setup();
		factory.reject(0, new Error('first'));
		await flush();

		open();
		factory.resolve(1);
		await flush();

		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
	});
});

describe('SceneSession lifecycle ownership', () => {
	it('aborts the signal and destroys a scene that arrives after stop', async () => {
		const { factory, store, session } = setup();

		session.stop();
		expect(factory.calls[0]?.signal.aborted).toBe(true);

		const scene = factory.resolve(0);
		await flush();

		expect(scene.destroyCount).toBe(1);
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
	});

	it('destroys the scene once and releases every subscription on repeated stop', async () => {
		const { session, scene } = await readySession();
		expect(scene.liveSubscriptions).toBe(5);

		session.stop();
		session.stop();

		expect(scene.destroyCount).toBe(1);
		expect(scene.liveSubscriptions).toBe(0);
	});

	it('clears heading, scale and settled when it stops', async () => {
		const { session, scene, store } = await readySession();
		session.setTarget(ACONCAGUA);
		await flush();
		scene.emitOrientation(120);
		scene.emitScale({ label: '1 km', meters: 1000, widthPx: 90 });
		expect(store.getSnapshot()).toMatchObject({ headingDegrees: 120, settled: true });

		session.stop();

		expect(store.getSnapshot()).toMatchObject({
			headingDegrees: undefined,
			scale: undefined,
			settled: false
		});
	});

	it('ignores scene events and commands once stopped', async () => {
		const { session, scene, store } = await readySession();
		session.stop();

		scene.emitOrientation(30);
		scene.setImageryDegraded(true);
		session.setTarget(ACONCAGUA);
		session.updateStage({ width: 1, height: 1 });

		expect(store.getSnapshot().headingDegrees).toBeUndefined();
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
		expect(scene.shown).toEqual([]);
		expect(scene.stages).toEqual([]);
		expect(session.resetView()).toBe('unavailable');
		expect(session.zoomView('in')).toBe('unavailable');
		expect(scene.zooms).toEqual([]);
	});

	it('keeps the scene methods bound to the scene across a whole lifecycle', async () => {
		const { session, scene, store } = await readySession({ cinematic: true });

		session.updateStage({ width: 800, height: 600 });
		session.setTarget(ACONCAGUA);
		await flush();
		session.setTarget(FITZ_ROY);
		await flush();
		expect(session.resetView()).toBe('reset');
		scene.emitOrientation(10);
		scene.emitScale({ label: '5 km', meters: 5000, widthPx: 70 });
		session.stop();

		expect(scene.resets).toBe(1);
		expect(scene.destroyCount).toBe(1);
		expect(store.getSnapshot().headingDegrees).toBeUndefined();
	});
});

describe('SceneSession best-effort stop', () => {
	const RELEASES: FakeReleaseStep[] = ['orientation', 'scale', 'imagery'];

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it.each(RELEASES)(
		'still releases the rest and destroys the scene when %s throws',
		async (step) => {
			const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
			const failure = new Error(`${step} release failed`);
			const { session, scene, store } = await readySession({ throwOnRelease: { [step]: failure } });
			scene.emitOrientation(40);
			scene.emitScale({ label: '1 km', meters: 1000, widthPx: 90 });

			expect(() => session.stop()).not.toThrow();

			expect(scene.destroyCount).toBe(1);
			expect(scene.liveSubscriptions).toBe(0);
			expect(store.getSnapshot()).toMatchObject({ headingDegrees: undefined, scale: undefined });
			expect(logged).toHaveBeenCalledOnce();
			expect(logged.mock.calls[0]?.[1]).toBe(failure);
		}
	);

	it('destroys the scene exactly once when every release throws', async () => {
		const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { session, scene } = await readySession({
			throwOnRelease: {
				orientation: new Error('orientation'),
				scale: new Error('scale'),
				imagery: new Error('imagery')
			}
		});

		expect(() => session.stop()).not.toThrow();
		session.stop();

		expect(scene.destroyCount).toBe(1);
		expect(scene.liveSubscriptions).toBe(0);
		expect(logged.mock.calls.map(([, cause]) => (cause as Error).message)).toEqual([
			'orientation',
			'scale',
			'imagery'
		]);
	});

	it('leaves no live scene behind for the retry that follows a failing stop', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { factory, open, session, scene } = await readySession({
			throwOnRelease: { orientation: new Error('orientation') }
		});

		session.stop();
		const next = open();
		const replacement = factory.resolve(1);
		await flush();

		expect(scene.destroyCount).toBe(1);
		expect(replacement.destroyCount).toBe(0);
		next.stop();
	});

	it('destroys the scene of a setup failure even when a release throws', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { store, factory, session } = setup();
		session.updateStage({ width: 800, height: 600 });
		const scene = factory.resolve(0, {
			throwOn: { updateStage: new Error('updateStage failed') },
			throwOnRelease: { orientation: new Error('orientation') }
		});
		await flush();

		expect(scene.destroyCount).toBe(1);
		expect(store.getSnapshot().state).toMatchObject({ status: 'failed' });
	});
});

describe('SceneSession under Strict Mode ordering', () => {
	it('creates, destroys and creates again when the first scene was already ready', async () => {
		const { factory, store, open, session: first } = setup();
		factory.resolve(0);
		await flush();

		first.stop();
		open();
		const second = factory.resolve(1);
		await flush();

		expect(factory.log).toEqual(['create:1', 'destroy:1', 'create:2']);
		expect(second.destroyed).toBe(false);
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
	});

	it('discards a first create that settles after the restart', async () => {
		const { factory, store, open, session: first } = setup();

		first.stop();
		open();
		expect(factory.log).toEqual(['create:1', 'create:2']);
		expect(factory.calls.map((call) => call.signal.aborted)).toEqual([true, false]);

		const stale = factory.resolve(0);
		await flush();
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		const live = factory.resolve(1);
		await flush();

		expect(factory.log).toEqual(['create:1', 'create:2', 'destroy:1']);
		expect(stale.destroyed).toBe(true);
		expect(live.destroyed).toBe(false);
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
	});

	it('does not let a stopped scene degrade or move its replacement', async () => {
		const { factory, store, open, session: first } = setup();
		const old = factory.resolve(0);
		await flush();
		first.stop();
		open();
		const live = factory.resolve(1);
		await flush();

		old.setImageryDegraded(true);
		old.emitOrientation(200);
		live.emitOrientation(15);

		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
		expect(store.getSnapshot().headingDegrees).toBe(15);
	});
});

async function presenting(sceneOptions = {}, target: SceneTarget = ACONCAGUA) {
	const context = setup();
	context.session.setTarget(target);
	const scene = context.factory.resolve(0, sceneOptions);
	await flush();
	return { ...context, scene };
}

describe('SceneSession presentation', () => {
	it('keeps loading until the placed mountain arrives and the view is ready', async () => {
		const { scene, store } = await presenting({ holdShow: true, holdViewReady: true });

		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
		expect(scene.shown).toEqual([{ target: ACONCAGUA, placement: 'initial' }]);

		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		expect(store.getSnapshot()).toMatchObject({ state: { status: 'loading' }, settled: true });

		scene.arriveViewReady();
		await flush();
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
	});

	it('releases the loader on the globe before the cinematic approach finishes', async () => {
		const { scene, store } = await presenting({
			cinematic: true,
			holdShow: true,
			holdViewReady: true
		});
		expect(scene.shown).toEqual([]);
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		scene.arriveViewReady();
		await flush();

		expect(store.getSnapshot()).toMatchObject({ state: { status: 'ready' }, settled: false });
		expect(scene.shown).toHaveLength(1);

		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		expect(store.getSnapshot().settled).toBe(true);
	});

	it('still reveals the mountain when the camera reports a failure', async () => {
		const { scene, store } = await presenting({ holdShow: true });

		scene.pendingShows[0]!.reject(new Error('camera'));
		await flush();

		expect(store.getSnapshot()).toMatchObject({ state: { status: 'ready' }, settled: false });
	});

	it('presents only the latest target supplied before the scene exists', async () => {
		const context = setup();
		context.session.setTarget(ACONCAGUA);
		context.session.setTarget(FITZ_ROY);
		const scene = context.factory.resolve(0);
		await flush();

		expect(scene.shown).toEqual([{ target: FITZ_ROY, placement: 'initial' }]);
	});

	it('does not present when no target is supplied', async () => {
		const { scene } = await readySession();

		expect(scene.shown).toEqual([]);
		expect(scene.prepared).toEqual([]);
	});

	it('forwards a later target to the same scene without covering the page again', async () => {
		const { session, scene, store, factory } = await presenting();
		const states: string[] = [];
		store.subscribe(() => states.push(store.getSnapshot().state.status));

		session.setTarget(FITZ_ROY);
		await flush();

		expect(scene.shown.map((shown) => [shown.target.slug, shown.placement])).toEqual([
			['aconcagua', 'initial'],
			['fitz-roy', 'next']
		]);
		expect(states).not.toContain('loading');
		expect(factory.calls).toHaveLength(1);
	});

	it('lets only the latest presentation settle', async () => {
		const { session, scene, store } = await presenting({ holdShow: true });
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();

		session.setTarget(FITZ_ROY);
		session.setTarget(ACONCAGUA);
		expect(store.getSnapshot().settled).toBe(false);

		scene.pendingShows[1]!.resolve({ status: 'arrived' });
		await flush();
		expect(store.getSnapshot().settled).toBe(false);

		scene.pendingShows[2]!.resolve({ status: 'interrupted' });
		await flush();
		expect(store.getSnapshot().settled).toBe(false);

		session.setTarget(FITZ_ROY);
		scene.pendingShows[3]!.resolve({ status: 'arrived' });
		await flush();
		expect(store.getSnapshot().settled).toBe(true);
	});

	it('ignores an outcome that settles after stop', async () => {
		const { session, scene, store } = await presenting({ holdShow: true, holdViewReady: true });

		session.stop();
		scene.pendingShows[0]?.resolve({ status: 'arrived' });
		await flush();

		expect(store.getSnapshot()).toMatchObject({ state: { status: 'loading' }, settled: false });
	});
});

describe('SceneSession stage and reset', () => {
	it('applies a stage measured before the scene exists, then forwards later ones', async () => {
		const { session, factory } = setup();
		session.updateStage({ width: 800, height: 600 });
		const scene = factory.resolve(0);
		await flush();

		session.updateStage({ width: 400, height: 700 });

		expect(scene.stages).toEqual([
			{ width: 800, height: 600 },
			{ width: 400, height: 700 }
		]);
	});

	it('resets only while the presented mountain is settled', async () => {
		const { session, scene } = await presenting({ holdShow: true });
		expect(session.resetView()).toBe('unavailable');

		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		scene.resetResult = 'unchanged';
		expect(session.resetView()).toBe('unchanged');

		session.setTarget(FITZ_ROY);
		expect(session.resetView()).toBe('unavailable');
		expect(scene.resets).toBe(1);
	});

	it('zooms only while the presented mountain is settled and passes the scene result through', async () => {
		const { session, scene } = await presenting({ holdShow: true });
		expect(session.zoomView('in')).toBe('unavailable');

		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		expect(session.zoomView('in')).toBe('zoomed');
		scene.zoomResult = 'limit';
		expect(session.zoomView('out')).toBe('limit');

		session.setTarget(FITZ_ROY);
		expect(session.zoomView('in')).toBe('unavailable');
		expect(scene.zooms).toEqual(['in', 'out']);
	});

	it('cannot zoom after a presentation that did not arrive', async () => {
		const { session, scene } = await presenting({ holdShow: true });

		scene.pendingShows[0]!.resolve({ status: 'interrupted' });
		await flush();

		expect(session.zoomView('in')).toBe('unavailable');
		expect(scene.zooms).toEqual([]);
	});

	it('reads the camera only while the presented mountain is settled', async () => {
		const { session, scene } = await presenting({ holdShow: true });
		scene.reading = READING;
		expect(session.readCamera()).toBeUndefined();
		expect(scene.reads).toBe(0);

		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		expect(session.readCamera()).toEqual(READING);

		session.setTarget(FITZ_ROY);
		expect(session.readCamera()).toBeUndefined();
	});

	it('reads no camera before the scene exists, once stopped, or when the scene has none', async () => {
		const early = setup();
		expect(early.session.readCamera()).toBeUndefined();

		const { session, scene } = await presenting();
		expect(session.readCamera()).toBeUndefined();

		scene.reading = READING;
		expect(session.readCamera()).toEqual(READING);
		session.stop();
		expect(session.readCamera()).toBeUndefined();
	});

	it('cannot reset when the scene failed to initialize', async () => {
		const { session, factory } = setup();
		factory.reject(0, new Error('boom'));
		await flush();

		expect(session.resetView()).toBe('unavailable');
	});
});

describe('SceneSession imagery degradation', () => {
	it('marks a ready scene degraded and back without returning to loading', async () => {
		const { scene, store } = await readySession();

		scene.setImageryDegraded(true);
		expect(store.getSnapshot().state).toEqual({ status: 'ready', imageryDegraded: true });

		scene.setImageryDegraded(false);
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
	});

	it('does not republish a repeated degradation', async () => {
		const { scene, store } = await readySession();
		const listener = vi.fn();

		scene.setImageryDegraded(true);
		store.subscribe(listener);
		scene.setImageryDegraded(true);

		expect(listener).not.toHaveBeenCalled();
	});

	it('goes from loading to degraded ready when imagery fails before the reveal', async () => {
		const { scene, store } = await presenting({ holdShow: true });
		scene.setImageryDegraded(true);
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();

		expect(store.getSnapshot().state).toEqual({ status: 'ready', imageryDegraded: true });
	});

	it('keeps the degraded flag when the next mountain is presented', async () => {
		const { session, scene, store } = await presenting();
		scene.setImageryDegraded(true);

		session.setTarget(FITZ_ROY);
		await flush();

		expect(store.getSnapshot().state).toEqual({ status: 'ready', imageryDegraded: true });
	});
});

describe('SceneSession synchronous setup failures', () => {
	const ATTACH_STEPS: FakeSetupStep[] = [
		'subscribeOrientation',
		'subscribeScale',
		'subscribeImageryHealth',
		'updateStage'
	];

	it.each(ATTACH_STEPS)(
		'ends in a controlled failure when %s throws during attach',
		async (step) => {
			const onError = vi.fn();
			const { store, factory, session } = setup({ onError });
			session.updateStage({ width: 800, height: 600 });
			const failure = new Error(`${step} failed`);

			const scene = factory.resolve(0, { throwOn: { [step]: failure } });
			await flush();

			expect(store.getSnapshot().state).toEqual({
				status: 'failed',
				failure: 'initialization-failed',
				message: 'The 3D globe could not be loaded.'
			});
			expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
			expect(scene.destroyCount).toBe(1);
			expect(scene.liveSubscriptions).toBe(0);
		}
	);

	it('ends in a controlled failure when reveal preparation throws', async () => {
		const onError = vi.fn();
		const { store, factory, session } = setup({ onError });
		session.setTarget(ACONCAGUA);
		const failure = new Error('prepareReveal failed');

		const scene = factory.resolve(0, { cinematic: true, throwOn: { prepareReveal: failure } });
		await flush();

		expect(store.getSnapshot().state).toMatchObject({
			status: 'failed',
			failure: 'initialization-failed'
		});
		expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
		expect(scene.destroyCount).toBe(1);
		expect(scene.shown).toEqual([]);
	});

	it('stays inert after a setup failure and stops without destroying twice', async () => {
		const { store, factory, session } = setup();
		const scene = factory.resolve(0, { throwOn: { subscribeScale: new Error('boom') } });
		await flush();

		session.setTarget(FITZ_ROY);
		session.updateStage({ width: 10, height: 10 });
		session.stop();
		await flush();

		expect(scene.shown).toEqual([]);
		expect(scene.destroyCount).toBe(1);
		expect(store.getSnapshot().state).toMatchObject({ status: 'failed' });
		expect(session.resetView()).toBe('unavailable');
	});

	it('does not publish a failure for a scene that failed after the session stopped', async () => {
		const onError = vi.fn();
		const { store, factory, session } = setup({ onError });
		session.stop();

		factory.resolve(0, { throwOn: { subscribeScale: new Error('boom') } });
		await flush();

		expect(onError).not.toHaveBeenCalled();
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
	});
});

describe('SceneSession render failures', () => {
	const FAILED = {
		status: 'failed',
		failure: 'initialization-failed',
		message: 'The 3D globe could not be loaded.'
	};

	it('ends in the controlled failure and destroys the scene when rendering stops', async () => {
		const onError = vi.fn();
		const { store, factory } = setup({ onError });
		const scene = factory.resolve(0);
		await flush();
		const failure = new Error('Expected width to be greater than 0, actual value was 0');

		scene.failRendering(failure);

		expect(store.getSnapshot().state).toEqual(FAILED);
		expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
		expect(scene.destroyCount).toBe(1);
		expect(scene.liveSubscriptions).toBe(0);
	});

	it('clears what the failed scene had published and reports the end of the session', async () => {
		const { store, scene, observer } = await observed();
		scene.emitScale({ label: '1 km', meters: 1000, widthPx: 90 });
		scene.emitOrientation(30);
		expect(store.getSnapshot()).toMatchObject({ headingDegrees: 30, settled: true });

		scene.failRendering(new Error('boom'));

		expect(store.getSnapshot()).toMatchObject({
			headingDegrees: undefined,
			scale: undefined,
			settled: false,
			free: false
		});
		expect(observer.log.at(-1)).toBe('ended');
	});

	it('fails a scene that is still revealing its first mountain', async () => {
		const { store, scene } = await observed({ holdShow: true, holdViewReady: true });

		scene.failRendering(new Error('boom'));
		scene.pendingShows[0]?.resolve({ status: 'arrived' });
		await flush();

		expect(store.getSnapshot().state).toEqual(FAILED);
	});

	it('reports a repeated failure once', async () => {
		const onError = vi.fn();
		const { factory } = setup({ onError });
		const scene = factory.resolve(0);
		await flush();

		scene.failRendering(new Error('first'));
		scene.failRendering(new Error('second'));

		expect(onError).toHaveBeenCalledOnce();
		expect(scene.destroyCount).toBe(1);
	});

	it('ignores a failure that arrives after stop', async () => {
		const onError = vi.fn();
		const { store, factory, session } = setup({ onError });
		const scene = factory.resolve(0);
		await flush();

		session.stop();
		scene.failRendering(new Error('late'));

		expect(onError).not.toHaveBeenCalled();
		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
		expect(scene.destroyCount).toBe(1);
	});

	it('does not let the failed scene move its replacement', async () => {
		const { store, factory, open, session } = setup();
		const scene = factory.resolve(0);
		await flush();
		scene.failRendering(new Error('boom'));

		const next = open();
		const replacement = factory.resolve(1);
		await flush();
		scene.failRendering(new Error('stale'));

		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
		expect(replacement.destroyCount).toBe(0);
		expect(session.resetView()).toBe('unavailable');
		next.stop();
	});

	it('destroys the scene even when a release throws while failing', async () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { store, factory } = setup();
		const scene = factory.resolve(0, { throwOnRelease: { scale: new Error('scale') } });
		await flush();

		scene.failRendering(new Error('boom'));

		expect(scene.destroyCount).toBe(1);
		expect(store.getSnapshot().state).toEqual(FAILED);
	});
});

class RecordingObserver implements PresentationObserver {
	readonly log: string[] = [];

	presenting(target: SceneTarget): void {
		this.log.push(`presenting:${target.slug}`);
	}

	presented(target: SceneTarget, outcome: PresentationOutcome): void {
		this.log.push(`presented:${target.slug}:${outcome}`);
	}

	cleared(): void {
		this.log.push('cleared');
	}

	ended(): void {
		this.log.push('ended');
	}
}

async function observed(sceneOptions = {}, target: SceneTarget | undefined = ACONCAGUA) {
	const observer = new RecordingObserver();
	const context = setup({ observer });
	if (target) {
		context.session.setTarget(target);
	}
	const scene = context.factory.resolve(0, sceneOptions);
	await flush();
	return { ...context, scene, observer };
}

describe('SceneSession presentation reports', () => {
	it('reports the initial presentation and its arrival', async () => {
		const { observer } = await observed();

		expect(observer.log).toEqual(['presenting:aconcagua', 'presented:aconcagua:arrived']);
	});

	it('reports a camera failure of the presentation that is still current', async () => {
		const { observer, scene } = await observed({ holdShow: true });

		scene.pendingShows[0]!.reject(new Error('camera'));
		await flush();

		expect(observer.log).toEqual(['presenting:aconcagua', 'presented:aconcagua:failed']);
	});

	it('reports a camera that was interrupted without being superseded', async () => {
		const { observer, scene } = await observed({ holdShow: true });

		scene.pendingShows[0]!.resolve({ status: 'interrupted' });
		await flush();

		expect(observer.log).toEqual(['presenting:aconcagua', 'presented:aconcagua:interrupted']);
	});

	it('reports a later target as a new presentation of the same scene', async () => {
		const { observer, session } = await observed();

		session.setTarget(FITZ_ROY);
		await flush();

		expect(observer.log).toEqual([
			'presenting:aconcagua',
			'presented:aconcagua:arrived',
			'presenting:fitz-roy',
			'presented:fitz-roy:arrived'
		]);
	});

	it('never reports the outcome of a superseded presentation', async () => {
		const { observer, session, scene } = await observed({ holdShow: true });
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		observer.log.length = 0;

		session.setTarget(FITZ_ROY);
		session.setTarget(ACONCAGUA);
		scene.pendingShows[1]!.resolve({ status: 'arrived' });
		await flush();
		expect(observer.log).toEqual(['presenting:fitz-roy', 'presenting:aconcagua']);

		scene.pendingShows[2]!.resolve({ status: 'arrived' });
		await flush();
		expect(observer.log.at(-1)).toBe('presented:aconcagua:arrived');
		expect(observer.log).not.toContain('presented:fitz-roy:arrived');
	});

	it('reports nothing for a target that waits for a scene that does not exist yet', () => {
		const observer = new RecordingObserver();
		const { session } = setup({ observer });

		session.setTarget(ACONCAGUA);

		expect(observer.log).toEqual([]);
	});

	it('reports the end of the session once, however often it is stopped', async () => {
		const { observer, session } = await observed();
		observer.log.length = 0;

		session.stop();
		session.stop();

		expect(observer.log).toEqual(['ended']);
	});

	it('reports nothing for an outcome that settles after stop', async () => {
		const { observer, session, scene } = await observed({ holdShow: true });
		session.stop();
		observer.log.length = 0;

		scene.pendingShows[0]?.resolve({ status: 'arrived' });
		await flush();
		session.setTarget(FITZ_ROY);

		expect(observer.log).toEqual([]);
	});

	it('reports the end when the scene fails to initialize', async () => {
		const observer = new RecordingObserver();
		const { factory } = setup({ observer });

		factory.reject(0, new Error('WebGL unavailable'));
		await flush();

		expect(observer.log).toEqual(['ended']);
	});

	it('reports the end when attaching a ready scene throws', async () => {
		const observer = new RecordingObserver();
		const { factory } = setup({ observer });

		factory.resolve(0, { throwOn: { subscribeScale: new Error('boom') } });
		await flush();

		expect(observer.log).toEqual(['ended']);
	});

	it('reports a target it can never present as the end of the session', async () => {
		const observer = new RecordingObserver();
		const { session } = setup({ ionToken: undefined, observer });

		session.setTarget(ACONCAGUA);

		expect(observer.log).toEqual(['ended']);
	});

	it('reports a target set after an initialization failure as the end of the session', async () => {
		const observer = new RecordingObserver();
		const { session, factory } = setup({ observer });
		factory.reject(0, new Error('WebGL unavailable'));
		await flush();
		observer.log.length = 0;

		session.setTarget(FITZ_ROY);

		expect(observer.log).toEqual(['ended']);
	});
});

describe('SceneSession with the transition coordinator', () => {
	it('arrives at the destination the scene travelled to', async () => {
		const coordinator = new TransitionCoordinator();
		const context = setup({ observer: coordinator });
		context.session.setTarget(ACONCAGUA);
		const scene = context.factory.resolve(0, { holdShow: true });
		await flush();
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();

		const transition = coordinator.begin('fitz-roy');
		context.session.setTarget(FITZ_ROY);
		scene.pendingShows[1]!.resolve({ status: 'arrived' });

		await expect(transition.arrival).resolves.toBe('arrived');
	});

	it('supersedes the transition when another target takes over mid-travel', async () => {
		const coordinator = new TransitionCoordinator();
		const context = setup({ observer: coordinator });
		context.session.setTarget(ACONCAGUA);
		const scene = context.factory.resolve(0, { holdShow: true });
		await flush();
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();

		const transition = coordinator.begin('fitz-roy');
		context.session.setTarget(FITZ_ROY);
		context.session.setTarget(ACONCAGUA);
		scene.pendingShows[1]!.resolve({ status: 'arrived' });

		await expect(transition.arrival).resolves.toBe('superseded');
		expect(scene.destroyCount).toBe(0);
	});

	it('lets only the current presentation of a repeated mountain complete its transition', async () => {
		const coordinator = new TransitionCoordinator();
		const context = setup({ observer: coordinator });
		context.session.setTarget(ACONCAGUA);
		const scene = context.factory.resolve(0, { holdShow: true });
		await flush();
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();

		context.session.setTarget(FITZ_ROY);
		context.session.setTarget(ACONCAGUA);
		const transition = coordinator.begin('fitz-roy');
		context.session.setTarget(FITZ_ROY);

		scene.pendingShows[1]!.resolve({ status: 'arrived' });
		await flush();
		expect(await Promise.race([transition.arrival, Promise.resolve('pending')])).toBe('pending');

		scene.pendingShows[2]!.resolve({ status: 'arrived' });
		await flush();
		expect(await Promise.race([transition.arrival, Promise.resolve('pending')])).toBe('pending');

		scene.pendingShows[3]!.resolve({ status: 'failed', error: new Error('current') });
		await expect(transition.arrival).resolves.toBe('failed');
	});

	it('interrupts the transition when the session stops, keeping nothing pending', async () => {
		const coordinator = new TransitionCoordinator();
		const context = setup({ observer: coordinator });
		context.session.setTarget(ACONCAGUA);
		context.factory.resolve(0, { holdShow: true });
		await flush();

		const transition = coordinator.begin('fitz-roy');
		context.session.stop();

		await expect(transition.arrival).resolves.toBe('interrupted');
	});
});

const ATLAS = ATLAS_VIEW;
// The sessions below never measure a stage, so the overview fits an unmeasured one.
const OVERVIEW = atlasOverviewLook(ATLAS, undefined);

async function onAtlas(sceneOptions = {}) {
	const context = setup();
	context.session.setAtlas(ATLAS);
	const scene = context.factory.resolve(0, sceneOptions);
	await flush();
	return { ...context, scene };
}

describe('SceneSession on the atlas', () => {
	it('opens on the overview, placed at once, and keeps loading until the view is ready', async () => {
		const { session, factory, store } = setup();
		session.setAtlas(ATLAS);
		const scene = factory.resolve(0, { holdViewReady: true });
		await flush();

		expect(scene.overviews).toEqual([{ look: OVERVIEW, animate: false }]);
		expect(store.getSnapshot()).toMatchObject({
			state: { status: 'loading' },
			free: false,
			rotation: 'off'
		});
		expect(scene.orbiting).toBe(false);

		scene.arriveViewReady();
		await flush();

		expect(store.getSnapshot()).toMatchObject({
			state: { status: 'ready' },
			settled: false,
			free: true,
			rotation: 'rotating'
		});
		expect(scene.orbits).toEqual([
			expect.objectContaining({ periodSeconds: ATLAS_ORBIT_PERIOD_SECONDS, running: true })
		]);
		expect(scene.shown).toEqual([]);
	});

	it('fits the overview to the measured stage', async () => {
		const { session, factory } = setup();
		const stage = { width: 360, height: 420 };
		session.updateStage(stage);
		session.setAtlas(ATLAS);
		const scene = factory.resolve(0);
		await flush();

		expect(scene.overviews).toEqual([{ look: atlasOverviewLook(ATLAS, stage), animate: false }]);
	});

	it('never turns the globe for a reader who prefers reduced motion', async () => {
		const { scene, store, session } = await onAtlas({ reducedMotion: true });

		expect(scene.overviews).toHaveLength(1);
		expect(scene.orbits).toEqual([]);
		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'off' });

		session.toggleRotation();
		expect(scene.orbits).toEqual([]);
	});

	it('stops turning at a press or wheel on the globe, until asked to resume', async () => {
		const { scene, store, session } = await onAtlas();
		scene.holdShow = true;

		scene.interact();

		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot().rotation).toBe('paused');

		// The camera may be anywhere now: resuming flies back to the overview first.
		session.toggleRotation();
		expect(scene.overviews.at(-1)).toEqual({ look: OVERVIEW, animate: true });
		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot().rotation).toBe('rotating');

		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();

		expect(scene.orbiting).toBe(true);
	});

	it('stops turning when something else moves the camera', async () => {
		const { scene, store } = await onAtlas();

		scene.haltOrbit();

		expect(store.getSnapshot().rotation).toBe('paused');
	});

	it('pauses in place and resumes in place, without a flight', async () => {
		const { scene, store, session } = await onAtlas();

		session.toggleRotation();
		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot().rotation).toBe('paused');

		session.toggleRotation();
		expect(scene.orbiting).toBe(true);
		expect(scene.orbits).toHaveLength(2);
		expect(scene.overviews).toHaveLength(1);
		expect(store.getSnapshot().rotation).toBe('rotating');
	});

	it('keeps a reader’s pause through Reset, which still returns to the overview', async () => {
		const { scene, store, session } = await onAtlas();
		session.toggleRotation();

		expect(session.resetView()).toBe('reset');
		await flush();

		expect(scene.overviews.at(-1)).toEqual({ look: OVERVIEW, animate: true });
		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot().rotation).toBe('paused');
	});

	it('zooms in free mode, ending the orbit, but reads no camera', async () => {
		const { scene, store, session } = await onAtlas();
		scene.reading = READING;

		expect(session.zoomView('in')).toBe('zoomed');

		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot().rotation).toBe('paused');
		expect(session.readCamera()).toBeUndefined();
		expect(scene.reads).toBe(0);
	});

	it('resets a free camera to the overview through an animated flight, then turns again', async () => {
		const { scene, store, session } = await onAtlas();
		scene.holdShow = true;
		scene.interact();

		expect(session.resetView()).toBe('reset');
		expect(scene.overviews.at(-1)).toEqual({ look: OVERVIEW, animate: true });
		expect(store.getSnapshot().free).toBe(false);
		expect(session.zoomView('in')).toBe('unavailable');

		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();

		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'rotating' });
		expect(scene.orbiting).toBe(true);
		expect(scene.resets).toBe(0);
	});

	it('does not start turning under someone who touched the globe during the flight', async () => {
		const { scene, session } = await onAtlas();
		scene.holdShow = true;
		session.resetView();

		scene.interact();
		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();

		expect(scene.orbiting).toBe(false);
	});

	it('stays free without turning when the overview flight is interrupted', async () => {
		const { scene, store, session } = await onAtlas();
		scene.holdShow = true;
		session.resetView();

		scene.pendingOverviews[0]!({ status: 'interrupted' });
		await flush();

		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'paused' });
		expect(scene.orbiting).toBe(false);
	});

	it('keeps Reset unavailable for a free camera off the atlas', async () => {
		const { session, factory, store } = setup();
		factory.resolve(0);
		await flush();

		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'off' });
		expect(session.resetView()).toBe('unavailable');
	});

	it('lets a mountain set before the scene exists take over the overview reveal', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);
		session.setTarget(FITZ_ROY);
		const scene = factory.resolve(0);
		await flush();

		expect(scene.overviews).toEqual([]);
		expect(scene.shown).toEqual([{ target: FITZ_ROY, placement: 'initial' }]);
	});

	it('ends in a controlled failure when placing the overview throws', async () => {
		const { session, factory, store } = setup({ onError: () => {} });
		session.setAtlas(ATLAS);
		const scene = factory.resolve(0);
		scene.showOverview = () => {
			throw new Error('overview');
		};
		await flush();

		expect(store.getSnapshot().state).toMatchObject({ status: 'failed' });
		expect(scene.destroyed).toBe(true);
	});

	it('stops the orbit and lets go of the interaction listener when it stops', async () => {
		const { scene, store, session } = await onAtlas();

		session.stop();

		expect(scene.orbiting).toBe(false);
		expect(scene.liveSubscriptions).toBe(0);
		expect(store.getSnapshot()).toMatchObject({ free: false, rotation: 'off' });
	});
});

describe('SceneSession resizing on the atlas', () => {
	const PORTRAIT = { width: 390, height: 520 };
	const WIDE = { width: 900, height: 360 };

	it('refits the range of a turning overview without flying or restarting the orbit', async () => {
		const { scene, store, session } = await onAtlas();

		session.updateStage(WIDE);

		expect(scene.refits).toEqual([overviewRangeMeters(WIDE)]);
		expect(scene.overviews).toHaveLength(1);
		expect(scene.orbits).toHaveLength(1);
		expect(scene.orbiting).toBe(true);
		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'rotating' });
	});

	it('refits a paused overview and leaves it paused', async () => {
		const { scene, store, session } = await onAtlas();
		session.toggleRotation();

		session.updateStage(PORTRAIT);

		expect(scene.refits).toEqual([overviewRangeMeters(PORTRAIT)]);
		expect(scene.overviews).toHaveLength(1);
		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot().rotation).toBe('paused');
	});

	it('refits again for each new shape, ending on the last one', async () => {
		const { scene, session } = await onAtlas();

		session.updateStage(PORTRAIT);
		session.updateStage(WIDE);

		expect(scene.refits).toEqual([overviewRangeMeters(PORTRAIT), overviewRangeMeters(WIDE)]);
	});

	it('refits an overview that never turns for reduced motion', async () => {
		const { scene, session } = await onAtlas({ reducedMotion: true });

		session.updateStage(WIDE);

		expect(scene.refits).toEqual([overviewRangeMeters(WIDE)]);
		expect(scene.orbits).toEqual([]);
	});

	it('leaves a camera the reader moved where it is', async () => {
		const { scene, session } = await onAtlas();
		scene.interact();

		session.updateStage(WIDE);

		expect(scene.refits).toEqual([]);
		expect(scene.overviews).toHaveLength(1);
	});

	it('leaves a camera that a zoom step moved where it is', async () => {
		const { scene, session } = await onAtlas();
		session.zoomView('in');

		session.updateStage(WIDE);

		expect(scene.refits).toEqual([]);
	});

	it('restarts the overview flight for the new shape instead of refitting under it', async () => {
		const { scene, session } = await onAtlas();
		scene.holdShow = true;
		scene.refitResult = 'busy';
		session.resetView();

		session.updateStage(WIDE);

		expect(scene.overviews.at(-1)).toEqual({ look: atlasOverviewLook(ATLAS, WIDE), animate: true });
		expect(scene.overviews).toHaveLength(3);
		expect(scene.orbiting).toBe(false);

		scene.pendingOverviews.at(-1)!({ status: 'arrived' });
		await flush();

		expect(scene.orbiting).toBe(true);
	});

	it('refits an overview placed but still waiting for the globe to load', async () => {
		const { session, factory, store } = setup();
		session.setAtlas(ATLAS);
		const scene = factory.resolve(0, { holdViewReady: true });
		await flush();

		session.updateStage(WIDE);

		expect(scene.refits).toEqual([overviewRangeMeters(WIDE)]);
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		scene.arriveViewReady();
		await flush();

		expect(scene.orbiting).toBe(true);
	});

	it('ignores a stage with no area', async () => {
		const { scene, session } = await onAtlas();

		session.updateStage({ width: 0, height: 0 });

		expect(scene.refits).toEqual([]);
	});

	it('never refits off the atlas or after leaving it', async () => {
		const { scene, session } = await onAtlas();
		session.setAtlas(undefined);
		session.updateStage(WIDE);
		session.setTarget(ACONCAGUA);
		session.updateStage(PORTRAIT);

		expect(scene.refits).toEqual([]);
	});
});

describe('SceneSession entering and leaving the atlas', () => {
	// The layout tells the session about the atlas before it lets go of the mountain.
	function enterAtlas(session: SceneSession) {
		session.setAtlas(ATLAS);
		session.setTarget(undefined);
	}

	function leaveAtlasFor(session: SceneSession, target: SceneTarget) {
		session.setAtlas(undefined);
		session.setTarget(target);
	}

	it('lets go of a settled mountain and flies once from it to the overview', async () => {
		const observer = new RecordingObserver();
		const context = setup({ observer });
		context.session.setTarget(ACONCAGUA);
		const scene = context.factory.resolve(0, { holdShow: true });
		await flush();
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();

		enterAtlas(context.session);

		expect(scene.clears).toBeGreaterThanOrEqual(1);
		expect(scene.overviews).toEqual([{ look: OVERVIEW, animate: true }]);
		expect(context.store.getSnapshot()).toMatchObject({
			settled: false,
			free: false,
			rotation: 'rotating'
		});
		expect(context.session.readCamera()).toBeUndefined();

		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();

		expect(context.store.getSnapshot()).toMatchObject({ free: true, rotation: 'rotating' });
		expect(scene.orbiting).toBe(true);
		expect(observer.log).toEqual([
			'presenting:aconcagua',
			'presented:aconcagua:arrived',
			'cleared'
		]);
	});

	it('cuts a mountain flight short and flies from wherever it stopped', async () => {
		const { session, scene, observer, store } = await observed({ holdShow: true });
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		session.setTarget(FITZ_ROY);

		enterAtlas(session);
		await flush();

		expect(scene.overviews).toEqual([{ look: OVERVIEW, animate: true }]);
		expect(observer.log).toEqual([
			'presenting:aconcagua',
			'presented:aconcagua:arrived',
			'presenting:fitz-roy',
			'cleared'
		]);
		expect(store.getSnapshot().settled).toBe(false);
	});

	it('flies to the overview from a free camera that had no mountain to let go of', async () => {
		const { session, scene } = await readySession();

		session.setAtlas(ATLAS);

		expect(scene.overviews).toEqual([{ look: OVERVIEW, animate: true }]);
		expect(scene.clears).toBe(1);
	});

	it('flies only once however often the atlas is confirmed', async () => {
		const { session, scene } = await presenting();

		enterAtlas(session);
		session.setAtlas(ATLAS);
		session.setTarget(undefined);
		await flush();

		expect(scene.overviews).toHaveLength(1);
	});

	it('ends a reveal still in progress and flies to the overview instead', async () => {
		const { session, factory, store } = setup();
		session.setTarget(ACONCAGUA);
		const scene = factory.resolve(0, { holdShow: true });
		await flush();
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		enterAtlas(session);

		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
		expect(scene.overviews).toEqual([{ look: OVERVIEW, animate: true }]);
	});

	it('leaves the atlas by stopping the orbit and presenting the next mountain', async () => {
		const { session, scene, store } = await onAtlas();
		expect(scene.orbiting).toBe(true);

		leaveAtlasFor(session, FITZ_ROY);
		await flush();

		expect(scene.orbiting).toBe(false);
		expect(scene.shown).toEqual([{ target: FITZ_ROY, placement: 'next' }]);
		expect(store.getSnapshot()).toMatchObject({ settled: true, rotation: 'off' });
	});

	it('lets a mountain chosen during the overview flight take over, with no orbit after', async () => {
		const { session, scene, store } = await presenting({ holdShow: true });
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		enterAtlas(session);

		leaveAtlasFor(session, FITZ_ROY);
		await flush();
		scene.pendingShows.at(-1)!.resolve({ status: 'arrived' });
		await flush();

		expect(scene.shown.at(-1)).toEqual({ target: FITZ_ROY, placement: 'next' });
		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ settled: true, free: false });
	});

	it('returns to the overview on every visit, keeping a reader’s pause', async () => {
		const { session, scene, store } = await onAtlas();
		session.toggleRotation();

		leaveAtlasFor(session, FITZ_ROY);
		await flush();
		enterAtlas(session);
		await flush();

		expect(scene.overviews.at(-1)).toEqual({ look: OVERVIEW, animate: true });
		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot().rotation).toBe('paused');
	});
});

describe('SceneSession releasing its target off the atlas', () => {
	it('lets go of a settled mountain: no summit, no settled, a free camera that stays put', async () => {
		const { session, scene, store } = await presenting();
		expect(store.getSnapshot().settled).toBe(true);

		session.setTarget(undefined);

		expect(scene.clears).toBe(1);
		expect(scene.overviews).toEqual([]);
		expect(store.getSnapshot()).toMatchObject({ settled: false, free: true });
		expect(session.readCamera()).toBeUndefined();
		expect(session.zoomView('in')).toBe('zoomed');
	});

	it('ends a reveal still in progress instead of leaving the loader up', async () => {
		const { session, factory, store } = setup();
		session.setTarget(ACONCAGUA);
		factory.resolve(0, { holdShow: true });
		await flush();
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		session.setTarget(undefined);

		expect(store.getSnapshot()).toMatchObject({ state: { status: 'ready' }, free: true });
	});

	it('does nothing for a target that was never set', async () => {
		const { session, scene } = await readySession();

		session.setTarget(undefined);

		expect(scene.clears).toBe(0);
	});

	it('presents a mountain again after a release', async () => {
		const { session, scene, store } = await presenting();
		session.setTarget(undefined);

		session.setTarget(FITZ_ROY);
		await flush();

		expect(scene.shown.at(-1)).toEqual({ target: FITZ_ROY, placement: 'next' });
		expect(store.getSnapshot()).toMatchObject({ settled: true, free: false });
	});

	it('settles a pending transition as superseded and keeps nothing pending', async () => {
		const coordinator = new TransitionCoordinator();
		const context = setup({ observer: coordinator });
		context.session.setTarget(ACONCAGUA);
		context.factory.resolve(0, { holdShow: true });
		await flush();
		const transition = coordinator.begin('aconcagua');

		context.session.setTarget(undefined);

		await expect(transition.arrival).resolves.toBe('superseded');
		const later = coordinator.begin('aconcagua');
		later.cancel();
		await expect(later.arrival).resolves.toBe('interrupted');
	});

	it('clears free mode when it stops', async () => {
		const { session, factory, store } = setup();
		factory.resolve(0);
		await flush();
		expect(store.getSnapshot().free).toBe(true);

		session.stop();

		expect(store.getSnapshot().free).toBe(false);
	});
});

describe('SceneSession atlas markers', () => {
	const MARKERS: AtlasMarker[] = [
		{
			slug: 'aconcagua',
			name: 'Aconcagua',
			latitude: -32.653,
			longitude: -70.011,
			elevationMeters: 6961
		}
	];
	const MORE_MARKERS: AtlasMarker[] = [
		...MARKERS,
		{
			slug: 'fitz-roy',
			name: 'Fitz Roy',
			latitude: -49.271,
			longitude: -73.043,
			elevationMeters: 3405
		}
	];

	it('hands markers set before the scene exists to the scene before it reveals anything', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);
		session.setAtlasMarkers(MARKERS);

		const scene = factory.resolve(0);
		await flush();

		expect(scene.markerSets).toEqual([MARKERS]);
		expect(scene.overviews).toEqual([{ look: OVERVIEW, animate: false }]);
	});

	it('replaces the markers on a live scene without moving the camera or the orbit', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);
		session.setAtlasMarkers(MARKERS);
		const scene = factory.resolve(0);
		await flush();
		expect(scene.orbiting).toBe(true);

		session.setAtlasMarkers(MORE_MARKERS);

		expect(scene.atlasMarkers).toBe(MORE_MARKERS);
		expect(scene.overviews).toHaveLength(1);
		expect(scene.orbits).toHaveLength(1);
		expect(scene.orbiting).toBe(true);
	});

	it('takes the markers away in the same step that presents the next mountain', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);
		session.setAtlasMarkers(MARKERS);
		const scene = factory.resolve(0);
		await flush();

		session.setAtlas(undefined);
		session.setAtlasMarkers(undefined);
		session.setTarget(ACONCAGUA);

		expect(scene.atlasMarkers).toBeUndefined();
		expect(scene.shown).toEqual([{ target: ACONCAGUA, placement: 'next' }]);
	});

	it('hides and restores the markers on the atlas without touching the camera, the orbit or the look', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);
		session.setAtlasMarkers(MARKERS);
		const scene = factory.resolve(0);
		await flush();

		session.setAtlasMarkers(undefined);
		expect(scene.atlasMarkers).toBeUndefined();
		session.setAtlasMarkers(MARKERS);

		expect(scene.atlasMarkers).toBe(MARKERS);
		expect(scene.markerSets).toEqual([MARKERS, undefined, MARKERS]);
		expect(scene.overviews).toEqual([{ look: OVERVIEW, animate: false }]);
		expect(scene.orbits).toHaveLength(1);
		expect(scene.orbiting).toBe(true);
		expect(scene.presentations).toEqual([true]);
	});

	it('keeps the markers hidden for a scene that does not exist yet, and still presents the atlas', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);
		session.setAtlasMarkers(undefined);

		const scene = factory.resolve(0);
		await flush();

		expect(scene.markerSets).toEqual([]);
		expect(scene.presentations).toEqual([true]);
		expect(scene.overviews).toEqual([{ look: OVERVIEW, animate: false }]);
	});

	it('hands no markers to a scene for a mountain page', async () => {
		const { session, factory } = setup();
		session.setTarget(ACONCAGUA);

		const scene = factory.resolve(0);
		await flush();

		expect(scene.markerSets).toEqual([]);
	});

	it('ignores markers once stopped', async () => {
		const { session, scene } = await readySession();

		session.stop();
		session.setAtlasMarkers(MARKERS);

		expect(scene.markerSets).toEqual([]);
	});
});

describe('SceneSession marker emphasis', () => {
	it('hands an emphasis to the live scene without moving the camera or the orbit', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);
		const scene = factory.resolve(0);
		await flush();

		session.highlightMarker('aconcagua');
		session.highlightMarker(undefined);

		expect(scene.highlights).toEqual(['aconcagua', undefined]);
		expect(scene.overviews).toHaveLength(1);
		expect(scene.orbits).toHaveLength(1);
		expect(scene.orbiting).toBe(true);
	});

	it('does not keep an emphasis for a scene that does not exist yet', async () => {
		const { session, factory } = setup();

		session.highlightMarker('aconcagua');
		const scene = factory.resolve(0);
		await flush();

		expect(scene.highlights).toEqual([]);
	});

	it('asks nothing of a scene once stopped', async () => {
		const { session, factory } = setup();
		const scene = factory.resolve(0);
		await flush();

		session.stop();
		session.highlightMarker('aconcagua');

		expect(scene.highlights).toEqual([]);
	});
});

describe('SceneSession marker activation', () => {
	const MARKERS: AtlasMarker[] = [
		{
			slug: 'fitz-roy',
			name: 'Fitz Roy',
			latitude: -49.271,
			longitude: -73.043,
			elevationMeters: 3405
		}
	];
	const OPEN_FITZ_ROY = {
		kind: 'mountain',
		mountain: { slug: 'fitz-roy', name: 'Fitz Roy', elevationMeters: 3405 }
	} as const;

	async function onAtlas() {
		const onMarkerActivate = vi.fn();
		const context = setup({ onMarkerActivate });
		context.session.setAtlas(ATLAS);
		context.session.setAtlasMarkers(MARKERS);
		const scene = context.factory.resolve(0);
		await flush();
		return { ...context, scene, onMarkerActivate };
	}

	it('passes on activations while markers are drawn', async () => {
		const { scene, onMarkerActivate } = await onAtlas();

		scene.activate(OPEN_FITZ_ROY);

		expect(onMarkerActivate).toHaveBeenCalledWith(OPEN_FITZ_ROY);
	});

	it('passes on nothing while the markers are hidden on the atlas, and again once they are back', async () => {
		const { session, scene, onMarkerActivate } = await onAtlas();

		session.setAtlasMarkers(undefined);
		scene.activate(OPEN_FITZ_ROY);
		expect(onMarkerActivate).not.toHaveBeenCalled();

		session.setAtlasMarkers(MARKERS);
		scene.activate(OPEN_FITZ_ROY);
		expect(onMarkerActivate).toHaveBeenCalledOnce();
	});

	it('passes on nothing once the markers are taken away for a mountain page', async () => {
		const { session, scene, onMarkerActivate } = await onAtlas();

		session.setAtlas(undefined);
		session.setAtlasMarkers(undefined);
		session.setTarget(ACONCAGUA);
		scene.activate(OPEN_FITZ_ROY);

		expect(onMarkerActivate).not.toHaveBeenCalled();
	});

	it('subscribes nothing when nobody listens', async () => {
		const { scene } = await readySession();

		expect(scene.liveSubscriptions).toBe(5);
	});

	it('ends the subscription when it stops, so a retry never doubles it', async () => {
		const { session, scene, onMarkerActivate } = await onAtlas();
		expect(scene.liveSubscriptions).toBe(6);

		session.stop();
		scene.activate(OPEN_FITZ_ROY);

		expect(scene.liveSubscriptions).toBe(0);
		expect(onMarkerActivate).not.toHaveBeenCalled();
	});

	it('does not move the camera or the orbit on an activation', async () => {
		const { scene } = await onAtlas();

		scene.activate(OPEN_FITZ_ROY);

		expect(scene.overviews).toHaveLength(1);
		expect(scene.shown).toEqual([]);
		expect(scene.orbiting).toBe(true);
	});
});

describe('SceneSession atlas presentation', () => {
	it('tells a new scene that it presents the atlas, before anything is revealed, even with no markers', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);

		const scene = factory.resolve(0);
		await flush();

		expect(scene.presentations).toEqual([true]);
		expect(scene.markerSets).toEqual([]);
	});

	it('tells a new scene for a mountain that it does not, so the globe look of the reveal stays', async () => {
		const { session, factory } = setup();
		session.setTarget(ACONCAGUA);

		const scene = factory.resolve(0);
		await flush();

		expect(scene.presentations).toEqual([false]);
	});

	it('follows the atlas in and out on the one scene, once per change', async () => {
		const { session, scene } = await readySession();
		expect(scene.presentations).toEqual([false]);

		session.setAtlas(ATLAS);
		session.setAtlas({ center: { ...ATLAS.center } });
		session.setAtlas(undefined);
		session.setAtlas(undefined);
		session.setAtlas(ATLAS);

		expect(scene.presentations).toEqual([false, true, false, true]);
	});

	it('ends the presentation in the same step that presents the next mountain', async () => {
		const { session, factory } = setup();
		session.setAtlas(ATLAS);
		const scene = factory.resolve(0);
		await flush();

		session.setAtlas(undefined);
		session.setTarget(ACONCAGUA);

		expect(scene.presentations).toEqual([true, false]);
		expect(scene.shown).toEqual([{ target: ACONCAGUA, placement: 'next' }]);
	});

	it('is not driven by the markers', async () => {
		const { session, scene } = await readySession();

		session.setAtlasMarkers([]);
		session.setAtlasMarkers(undefined);

		expect(scene.presentations).toEqual([false]);
	});

	it('says nothing once stopped', async () => {
		const { session, scene } = await readySession();

		session.stop();
		session.setAtlas(ATLAS);

		expect(scene.presentations).toEqual([false]);
	});
});

describe('SceneSession framing the places the atlas filters leave', () => {
	const ARGENTINA: AtlasView = {
		...ATLAS_VIEW,
		focus: [ACONCAGUA, FITZ_ROY, { latitude: -24.717, longitude: -68.541 }]
	};
	// The same framing from another subset: a place repeated adds no extent.
	const ARGENTINA_AGAIN: AtlasView = {
		...ATLAS_VIEW,
		focus: [...ARGENTINA.focus!, { ...ACONCAGUA }]
	};
	const MENDOZA: AtlasView = {
		...ATLAS_VIEW,
		focus: [ACONCAGUA, { latitude: -33.4, longitude: -69.9 }]
	};
	const FRAMED = atlasOverviewLook(ARGENTINA, undefined);

	async function framedOnAtlas(atlas: AtlasView = ARGENTINA, sceneOptions = {}) {
		const context = setup();
		context.session.setAtlas(atlas);
		const scene = context.factory.resolve(0, sceneOptions);
		await flush();
		return { ...context, scene };
	}

	it('opens on the framing, placed at once, and leaves the globe still', async () => {
		const { scene, store } = await framedOnAtlas();

		expect(scene.overviews).toEqual([{ look: FRAMED, animate: false }]);
		expect(FRAMED.rangeMeters).toBeLessThan(overviewRangeMeters(undefined));
		expect(scene.orbits).toEqual([]);
		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'off' });
	});

	it('flies from a turning overview to the framing and stays still on arrival', async () => {
		const { scene, store, session } = await onAtlas();
		scene.holdShow = true;

		session.setAtlas(ARGENTINA);

		expect(scene.overviews.at(-1)).toEqual({ look: FRAMED, animate: true });
		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ free: false, rotation: 'off' });

		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();

		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'off' });
	});

	it('flies once for the same places, and not at all for an equal object', async () => {
		const { scene, session } = await onAtlas();

		session.setAtlas(ARGENTINA);
		session.setAtlas({ ...ARGENTINA, focus: ARGENTINA.focus!.map((place) => ({ ...place })) });
		session.setAtlas(ARGENTINA);

		expect(scene.overviews).toHaveLength(2);
	});

	it('flies to the framing of a narrower subset', async () => {
		const { scene, session } = await framedOnAtlas();

		session.setAtlas(MENDOZA);

		expect(scene.overviews.at(-1)).toEqual({
			look: atlasOverviewLook(MENDOZA, undefined),
			animate: true
		});
		expect(scene.overviews).toHaveLength(2);
	});

	it('does not fly for a different subset that frames exactly the same', async () => {
		const { scene, session, store } = await framedOnAtlas();

		session.setAtlas(ARGENTINA_AGAIN);

		expect(scene.overviews).toHaveLength(1);
		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'off' });
	});

	it('flies back to the framing for a camera the reader moved, even when it is the same one', async () => {
		const { scene, session } = await framedOnAtlas();
		scene.interact();

		session.setAtlas(ARGENTINA_AGAIN);

		expect(scene.overviews.at(-1)).toEqual({
			look: atlasOverviewLook(ARGENTINA_AGAIN, undefined),
			animate: true
		});
		expect(scene.overviews).toHaveLength(2);
	});

	it('does not move a camera the reader moved when something other than the framing changes', async () => {
		const { scene, session } = await onAtlas();
		scene.interact();

		session.setAtlas({ ...ATLAS_VIEW });
		session.setAtlas({ center: { ...ATLAS_VIEW.center } });

		expect(scene.overviews).toHaveLength(1);
	});

	it('returns to the overview when the filters are reset, and turns again', async () => {
		const { scene, store, session } = await framedOnAtlas();
		scene.holdShow = true;

		session.setAtlas(ATLAS);

		expect(scene.overviews.at(-1)).toEqual({ look: OVERVIEW, animate: true });
		expect(store.getSnapshot().rotation).toBe('rotating');

		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();

		expect(scene.orbiting).toBe(true);
		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'rotating' });
	});

	it('keeps a reader’s pause through a framed visit and back to the overview', async () => {
		const { scene, store, session } = await onAtlas();
		session.toggleRotation();
		expect(store.getSnapshot().rotation).toBe('paused');

		session.setAtlas(ARGENTINA);
		expect(store.getSnapshot().rotation).toBe('off');
		// Nothing to resume while framed: the press changes neither the camera nor the choice.
		session.toggleRotation();
		expect(scene.orbits).toHaveLength(1);

		session.setAtlas(ATLAS);
		await flush();

		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot().rotation).toBe('paused');
	});

	it('does not turn the globe again under a reader who touched it during the flight', async () => {
		const { scene, store, session } = await onAtlas();
		scene.holdShow = true;
		session.setAtlas(ARGENTINA);

		scene.interact();
		scene.pendingOverviews[0]!({ status: 'interrupted' });
		await flush();

		expect(scene.orbiting).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'off' });
		// They own the camera now: an unrelated change of the same framing leaves it where it is.
		session.setAtlas({ ...ARGENTINA });
		expect(scene.overviews).toHaveLength(2);
	});

	it('ignores the arrival of a flight that a newer framing superseded', async () => {
		const { scene, store, session } = await framedOnAtlas();
		scene.holdShow = true;

		session.setAtlas(MENDOZA);
		session.setAtlas(ATLAS);
		// The scene ends the older flight as interrupted; that must not read as the camera being free.
		await flush();

		expect(scene.pendingOverviews).toHaveLength(1);
		expect(store.getSnapshot().free).toBe(false);
		expect(scene.orbiting).toBe(false);

		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();

		expect(store.getSnapshot().free).toBe(true);
		expect(scene.orbiting).toBe(true);
		expect(scene.overviews.at(-1)).toEqual({ look: OVERVIEW, animate: true });
	});

	it('places a reveal that is still loading on the framing in force when it ends', async () => {
		const { session, factory, store } = setup();
		session.setAtlas(ATLAS);
		const scene = factory.resolve(0, { holdViewReady: true });
		await flush();

		session.setAtlas(ARGENTINA);

		expect(scene.overviews.map(({ look, animate }) => ({ look, animate }))).toEqual([
			{ look: OVERVIEW, animate: false },
			{ look: FRAMED, animate: false }
		]);
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		await flush();
		scene.arriveViewReady();
		await flush();

		expect(store.getSnapshot().state).toEqual({ status: 'ready' });
		expect(scene.orbiting).toBe(false);
	});

	it('refits the range of the framing, not the overview, when the stage changes shape', async () => {
		const { scene, session } = await framedOnAtlas();
		const portrait = { width: 390, height: 700 };

		session.updateStage(portrait);

		expect(scene.refits).toEqual([atlasOverviewLook(ARGENTINA, portrait).rangeMeters]);
		expect(scene.refits[0]).not.toBe(overviewRangeMeters(portrait));
		expect(scene.overviews).toHaveLength(1);
	});

	it('frames from the stage it has measured', async () => {
		const { session, factory } = setup();
		const stage = { width: 390, height: 700 };
		session.updateStage(stage);
		session.setAtlas(ARGENTINA);
		const scene = factory.resolve(0);
		await flush();

		expect(scene.overviews).toEqual([
			{ look: atlasOverviewLook(ARGENTINA, stage), animate: false }
		]);
	});

	it('lets Reset return to the framing the filters set', async () => {
		const { scene, session } = await framedOnAtlas();
		scene.interact();

		expect(session.resetView()).toBe('reset');

		expect(scene.overviews.at(-1)).toEqual({ look: FRAMED, animate: true });
	});

	it('returns from a mountain to the filtered atlas and frames it', async () => {
		const { scene, session } = await framedOnAtlas();
		session.setAtlas(undefined);
		session.setTarget(ACONCAGUA);
		await flush();

		session.setAtlas(ARGENTINA);
		session.setTarget(undefined);
		await flush();

		expect(scene.overviews.at(-1)).toEqual({ look: FRAMED, animate: true });
		expect(scene.orbiting).toBe(false);
	});

	it('does not move the camera for a framing change while a mountain is presented', async () => {
		const { scene, session } = await onAtlas();
		session.setAtlas(undefined);
		session.setTarget(ACONCAGUA);
		await flush();
		const flights = scene.overviews.length;

		session.setAtlas(ARGENTINA);
		session.setAtlas(MENDOZA);

		expect(scene.overviews).toHaveLength(flights);
	});

	it('does not fly again on a resize after the reader interrupted the flight', async () => {
		const { scene, session } = await onAtlas();
		scene.holdShow = true;
		session.setAtlas(ARGENTINA);
		scene.interact();
		scene.pendingOverviews[0]!({ status: 'interrupted' });
		await flush();
		const flights = scene.overviews.length;

		session.updateStage({ width: 390, height: 700 });
		session.updateStage({ width: 900, height: 360 });

		expect(scene.overviews).toHaveLength(flights);
		expect(scene.refits).toEqual([]);
		expect(scene.orbiting).toBe(false);
	});

	it('never lets the late arrival of an older flight settle a newer one', async () => {
		const { scene, store, session } = await onAtlas();
		const late: ((outcome: { status: 'arrived' }) => void)[] = [];
		scene.showOverview = (look, animate) => {
			scene.overviews.push({ look, animate });
			return new Promise((resolve) => late.push(resolve));
		};

		session.setAtlas(ARGENTINA);
		session.setAtlas(MENDOZA);
		late[0]!({ status: 'arrived' });
		await flush();

		expect(store.getSnapshot().free).toBe(false);
		expect(scene.orbiting).toBe(false);

		late[1]!({ status: 'arrived' });
		await flush();

		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'off' });
		expect(scene.overviews.at(-1)!.look).toEqual(atlasOverviewLook(MENDOZA, undefined));
	});

	it('never moves or turns a scene that has stopped', async () => {
		const { scene, session } = await framedOnAtlas();
		session.stop();

		session.setAtlas(MENDOZA);

		expect(scene.overviews).toHaveLength(1);
	});
});

describe('SceneSession unit system', () => {
	const MARKERS: AtlasMarker[] = [
		{
			slug: 'aconcagua',
			name: 'Aconcagua',
			latitude: -32.653,
			longitude: -70.011,
			elevationMeters: 6961
		}
	];

	// Everything a unit change must leave exactly as it was.
	function presentation(scene: Awaited<ReturnType<typeof onAtlas>>['scene']) {
		return {
			shown: scene.shown.length,
			pendingShows: scene.pendingShows.length,
			overviews: scene.overviews.length,
			pendingOverviews: scene.pendingOverviews.length,
			refits: scene.refits.length,
			resets: scene.resets,
			clears: scene.clears,
			orbits: scene.orbits.length,
			orbiting: scene.orbiting,
			markerSets: scene.markerSets.length,
			presentations: scene.presentations.length,
			highlights: scene.highlights.length,
			destroys: scene.destroyCount
		};
	}

	it('gives the scene metric at wiring when none was chosen', async () => {
		const { scene } = await readySession();

		expect(scene.unitSystems).toEqual(['metric']);
	});

	it('keeps a choice made before the scene exists and applies it before anything is drawn', async () => {
		const { session, factory } = setup();
		session.setUnitSystem('imperial');
		session.setAtlas(ATLAS);
		session.setAtlasMarkers(MARKERS);
		session.setTarget(ACONCAGUA);
		const scene = factory.resolve(0);
		const units = vi.spyOn(scene, 'setUnitSystem');
		const drawn = vi.spyOn(scene, 'setAtlasMarkers');
		const shown = vi.spyOn(scene, 'showMountain');
		await flush();

		expect(units).toHaveBeenCalledWith('imperial');
		expect(units.mock.invocationCallOrder[0]!).toBeLessThan(drawn.mock.invocationCallOrder[0]!);
		expect(units.mock.invocationCallOrder[0]!).toBeLessThan(shown.mock.invocationCallOrder[0]!);
	});

	it('applies the last choice made before the scene exists, not every one', async () => {
		const { session, factory } = setup();
		session.setUnitSystem('imperial');
		session.setUnitSystem('metric');
		session.setUnitSystem('imperial');

		const scene = factory.resolve(0);
		await flush();

		expect(scene.unitSystems).toEqual(['imperial']);
	});

	it('hands a change to a ready scene at once, in order, without presenting anything again', async () => {
		const { session, scene } = await onAtlas();
		session.setAtlasMarkers(MARKERS);
		const before = presentation(scene);

		session.setUnitSystem('imperial');
		session.setUnitSystem('metric');
		session.setUnitSystem('imperial');

		expect(scene.unitSystems).toEqual(['metric', 'imperial', 'metric', 'imperial']);
		expect(presentation(scene)).toEqual(before);
	});

	it('leaves a mountain flight in the air alone', async () => {
		const { session, scene } = await presenting({ holdShow: true });
		const before = presentation(scene);

		session.setUnitSystem('imperial');

		expect(presentation(scene)).toEqual(before);
		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		expect(scene.shown).toHaveLength(1);
	});

	it('leaves a flight to the places the atlas filters leave alone', async () => {
		const { session, scene, store } = await onAtlas();
		scene.holdShow = true;
		session.setAtlas({ ...ATLAS_VIEW, focus: [ACONCAGUA, FITZ_ROY] });
		const before = presentation(scene);

		session.setUnitSystem('imperial');

		expect(presentation(scene)).toEqual(before);
		expect(store.getSnapshot()).toMatchObject({ free: false, rotation: 'off' });
		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();
		expect(scene.overviews).toHaveLength(2);
		expect(store.getSnapshot()).toMatchObject({ free: true, rotation: 'off' });
	});

	it('keeps an ambient orbit turning', async () => {
		const { session, scene } = await onAtlas();
		expect(scene.orbiting).toBe(true);

		session.setUnitSystem('imperial');

		expect(scene.orbiting).toBe(true);
		expect(scene.orbits).toHaveLength(1);
	});

	it('hands the choice to the scene a retry builds', async () => {
		const first = setup();
		first.session.setUnitSystem('imperial');
		first.factory.resolve(0);
		await flush();
		first.session.stop();

		const second = first.open();
		second.setUnitSystem('imperial');
		const scene = first.factory.resolve(1);
		await flush();

		expect(scene.unitSystems).toEqual(['imperial']);
	});

	it('does nothing once stopped, and never reaches the scene it released', async () => {
		const { session, scene } = await onAtlas();
		session.stop();

		session.setUnitSystem('imperial');

		expect(scene.unitSystems).toEqual(['metric']);
	});

	it('ignores a choice for a scene that failed to build', async () => {
		const { session, factory, store } = setup();

		factory.reject(0, new Error('no webgl'));
		await flush();

		expect(() => session.setUnitSystem('imperial')).not.toThrow();
		expect(store.getSnapshot().state).toMatchObject({ status: 'failed' });
	});
});

describe('SceneSession mountain orbit', () => {
	async function settledOn(sceneOptions = {}, target: SceneTarget = ACONCAGUA) {
		const context = await presenting({ holdShow: true, ...sceneOptions }, target);
		context.scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		return context;
	}

	it('is unavailable while the mountain is presented, and offered once it has arrived', async () => {
		const { scene, store, session } = await presenting({ holdShow: true });
		expect(store.getSnapshot().mountainOrbit).toBe('unavailable');

		session.toggleMountainOrbit();
		expect(scene.mountainOrbits).toEqual([]);

		scene.pendingShows[0]!.resolve({ status: 'arrived' });
		await flush();
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
	});

	it('stays unavailable when the presentation did not arrive', async () => {
		const { scene, store } = await presenting({ holdShow: true });

		scene.pendingShows[0]!.resolve({ status: 'interrupted' });
		await flush();

		expect(store.getSnapshot().mountainOrbit).toBe('unavailable');
	});

	it('is never offered on the atlas, apart from the atlas rotation', async () => {
		const { scene, store, session } = await onAtlas();

		expect(store.getSnapshot()).toMatchObject({ rotation: 'rotating', mountainOrbit: 'off' });
		session.toggleMountainOrbit();

		expect(scene.mountainOrbits).toEqual([]);
		expect(scene.orbiting).toBe(true);
	});

	it('never starts by itself', async () => {
		const { scene, store } = await settledOn();

		expect(scene.mountainOrbits).toEqual([]);
		expect(store.getSnapshot()).toMatchObject({ mountainOrbit: 'idle', rotation: 'off' });
	});

	it('starts from wherever the camera is, with no reset and no flight', async () => {
		const { scene, store, session } = await settledOn();

		session.toggleMountainOrbit();

		expect(scene.mountainOrbits).toEqual([
			expect.objectContaining({ periodSeconds: MOUNTAIN_ORBIT_PERIOD_SECONDS, running: true })
		]);
		expect(store.getSnapshot().mountainOrbit).toBe('orbiting');
		expect(scene.resets).toBe(0);
		expect(scene.shown).toHaveLength(1);
		expect(scene.overviews).toEqual([]);
		expect(scene.orbits).toEqual([]);
	});

	it('pauses where it is and resumes from there, never resetting the camera', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();

		session.toggleMountainOrbit();
		expect(scene.mountainOrbiting).toBe(false);
		expect(store.getSnapshot().mountainOrbit).toBe('paused');

		session.toggleMountainOrbit();
		expect(scene.mountainOrbiting).toBe(true);
		expect(scene.mountainOrbits).toHaveLength(2);
		expect(store.getSnapshot().mountainOrbit).toBe('orbiting');
		expect(scene.resets).toBe(0);
	});

	it('leaves the camera to the reader at a press or a wheel on the globe', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();

		scene.interact();

		expect(scene.mountainOrbiting).toBe(false);
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
		expect(scene.resets).toBe(0);

		session.toggleMountainOrbit();
		session.toggleMountainOrbit();
		scene.interact();
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
	});

	it('stops before an explicit zoom step acts', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();
		const stop = vi.spyOn(scene, 'stopMountainOrbit');
		const zoom = vi.spyOn(scene, 'zoomView');

		expect(session.zoomView('in')).toBe('zoomed');

		expect(stop.mock.invocationCallOrder[0]).toBeLessThan(zoom.mock.invocationCallOrder[0]!);
		expect(scene.mountainOrbiting).toBe(false);
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
	});

	it('stops before Reset, which restores the curated pose', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();
		session.toggleMountainOrbit();
		session.toggleMountainOrbit();
		const stop = vi.spyOn(scene, 'stopMountainOrbit');
		const reset = vi.spyOn(scene, 'resetView');

		expect(session.resetView()).toBe('reset');

		expect(stop.mock.invocationCallOrder[0]).toBeLessThan(reset.mock.invocationCallOrder[0]!);
		expect(scene.resets).toBe(1);
		expect(scene.mountainOrbiting).toBe(false);
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
	});

	it('forgets a pause once Reset or a zoom step has moved the camera', async () => {
		const { store, session } = await settledOn();
		session.toggleMountainOrbit();
		session.toggleMountainOrbit();
		expect(store.getSnapshot().mountainOrbit).toBe('paused');

		session.resetView();
		expect(store.getSnapshot().mountainOrbit).toBe('idle');

		session.toggleMountainOrbit();
		session.toggleMountainOrbit();
		session.zoomView('out');
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
	});

	it('is unavailable while a flight owns the camera, and offered again once it lands', async () => {
		const { scene, store, session } = await settledOn();
		scene.flying = true;
		expect(store.getSnapshot().mountainOrbit).toBe('unavailable');

		session.toggleMountainOrbit();
		expect(scene.mountainOrbits).toEqual([]);
		expect(store.getSnapshot().mountainOrbit).toBe('unavailable');

		scene.flying = false;
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
		session.toggleMountainOrbit();
		expect(store.getSnapshot().mountainOrbit).toBe('orbiting');
	});

	it('is unavailable through a reframe that halts a turning orbit, and idle once it lands', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();

		scene.flying = true;
		scene.haltMountainOrbit();
		expect(store.getSnapshot().mountainOrbit).toBe('unavailable');

		scene.flying = false;
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
	});

	it('keeps a pause through a flight, offering the resume once it lands', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();
		session.toggleMountainOrbit();

		scene.flying = true;
		expect(store.getSnapshot().mountainOrbit).toBe('unavailable');
		scene.flying = false;

		expect(store.getSnapshot().mountainOrbit).toBe('paused');
	});

	it('hears no flight once stopped', async () => {
		const { scene, store, session } = await settledOn();
		scene.flying = true;

		session.stop();
		scene.flying = false;

		expect(store.getSnapshot().mountainOrbit).toBe('off');
	});

	it('returns to idle when the orbit halts by itself', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();

		scene.haltMountainOrbit();

		expect(store.getSnapshot().mountainOrbit).toBe('idle');
	});

	it('cancels the orbit at once when the page moves on to another mountain', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();

		session.setTarget(FITZ_ROY);

		expect(scene.mountainOrbiting).toBe(false);
		expect(store.getSnapshot().mountainOrbit).toBe('unavailable');
		session.toggleMountainOrbit();
		expect(scene.mountainOrbits).toHaveLength(1);

		scene.pendingShows[1]!.resolve({ status: 'arrived' });
		await flush();
		expect(store.getSnapshot().mountainOrbit).toBe('idle');
		expect(scene.mountainOrbiting).toBe(false);
	});

	it('cancels the orbit when the reader returns to the atlas, whose rotation goes on', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();

		session.setAtlas(ATLAS);
		session.setTarget(undefined);

		expect(scene.mountainOrbiting).toBe(false);
		expect(store.getSnapshot().mountainOrbit).toBe('off');

		scene.pendingOverviews[0]!({ status: 'arrived' });
		await flush();
		expect(scene.orbiting).toBe(true);
		expect(scene.mountainOrbiting).toBe(false);
		expect(store.getSnapshot()).toMatchObject({ rotation: 'rotating', mountainOrbit: 'off' });
	});

	it('is never offered to a reader who prefers reduced motion', async () => {
		const { scene, store, session } = await settledOn({ reducedMotion: true });

		expect(store.getSnapshot().mountainOrbit).toBe('off');
		session.toggleMountainOrbit();

		expect(scene.mountainOrbits).toEqual([]);
	});

	it('ends with the session, and a retried scene starts idle', async () => {
		const { scene, store, session, open, factory } = await settledOn();
		session.toggleMountainOrbit();

		session.stop();
		expect(scene.mountainOrbiting).toBe(false);
		expect(store.getSnapshot().mountainOrbit).toBe('off');
		session.toggleMountainOrbit();
		expect(scene.mountainOrbits).toHaveLength(1);

		const retried = open();
		retried.setTarget(ACONCAGUA);
		const next = factory.resolve(1);
		await flush();

		expect(store.getSnapshot().mountainOrbit).toBe('idle');
		expect(next.mountainOrbits).toEqual([]);
	});

	it('ignores a halt that arrives after the session stopped', async () => {
		const { scene, store, session } = await settledOn();
		session.toggleMountainOrbit();
		const { onHalted } = scene.mountainOrbits[0]!;

		session.stop();
		onHalted();

		expect(store.getSnapshot().mountainOrbit).toBe('off');
	});
});
