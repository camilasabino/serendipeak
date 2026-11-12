import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeReleaseStep, FakeSetupStep } from '../test/FakeGlobeScene';
import { FakeSceneFactory } from '../test/FakeSceneFactory';
import {
	ATLAS_ORBIT_PERIOD_SECONDS,
	ATLAS_VIEW,
	atlasOverviewLook,
	overviewRangeMeters
} from './globe/atlasView';
import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
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
		expect(scene.liveSubscriptions).toBe(4);

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
