import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeReleaseStep, FakeSetupStep } from '../test/FakeGlobeScene';
import { FakeSceneFactory } from '../test/FakeSceneFactory';
import type { SceneTarget } from './globe/camera';
import { SceneSession, type SceneSessionOptions } from './SceneSession';
import { SceneStore } from './SceneStore';

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
		expect(scene.liveSubscriptions).toBe(3);

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
