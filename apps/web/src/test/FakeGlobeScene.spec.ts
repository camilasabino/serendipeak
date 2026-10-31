import { describe, expect, it, vi } from 'vitest';
import type { SceneTarget } from '../stage/globe/camera';
import { FakeGlobeScene } from './FakeGlobeScene';
import { FakeSceneFactory } from './FakeSceneFactory';

const TARGET: SceneTarget = {
	slug: 'aconcagua',
	name: 'Aconcagua',
	latitude: -32.653,
	longitude: -70.011,
	elevationMeters: 6961
};

describe('FakeGlobeScene', () => {
	it('arrives immediately unless a show is held', async () => {
		const scene = new FakeGlobeScene();

		await expect(scene.showMountain(TARGET, 'initial')).resolves.toEqual({ status: 'arrived' });

		scene.holdShow = true;
		const held = scene.showMountain(TARGET, 'next');
		scene.pendingShows[0]!.resolve({ status: 'interrupted' });

		await expect(held).resolves.toEqual({ status: 'interrupted' });
	});

	it('replaces an orientation subscription and tells the old listener it ended', () => {
		const scene = new FakeGlobeScene();
		const first = vi.fn();
		const second = vi.fn();

		scene.subscribeOrientation(first);
		scene.emitOrientation(40);
		scene.subscribeOrientation(second);
		scene.emitOrientation(50);

		expect(first.mock.calls).toEqual([[{ viewHeadingDegrees: 40 }], [undefined]]);
		expect(second.mock.calls).toEqual([[{ viewHeadingDegrees: 50 }]]);
		expect(scene.liveSubscriptions).toBe(1);
	});

	it('ignores the release function of a replaced subscription', () => {
		const scene = new FakeGlobeScene();
		const releaseFirst = scene.subscribeScale(vi.fn());
		const second = vi.fn();
		scene.subscribeScale(second);

		releaseFirst();
		scene.emitScale({ label: '1 km', meters: 1000, widthPx: 90 });

		expect(second).toHaveBeenCalledTimes(1);
	});

	it('replays a current imagery degradation to a late subscriber', () => {
		const scene = new FakeGlobeScene();
		scene.setImageryDegraded(true);
		const listener = vi.fn();

		scene.subscribeImageryHealth(listener);

		expect(listener).toHaveBeenCalledWith(true);
	});

	it('destroys idempotently and releases everything it owns', async () => {
		const onDestroy = vi.fn();
		const scene = new FakeGlobeScene({ onDestroy, holdShow: true, holdViewReady: true });
		const orientation = vi.fn();
		scene.subscribeOrientation(orientation);
		scene.subscribeScale(vi.fn());
		scene.subscribeImageryHealth(vi.fn());
		const pendingShow = scene.showMountain(TARGET, 'initial');
		const pendingView = scene.whenViewReady();

		scene.destroy();
		scene.destroy();

		expect(onDestroy).toHaveBeenCalledTimes(1);
		expect(scene.destroyCount).toBe(2);
		expect(scene.liveSubscriptions).toBe(0);
		await expect(pendingShow).resolves.toEqual({ status: 'interrupted' });
		await expect(pendingView).resolves.toBeUndefined();
	});

	it('answers calls after destroy without owning anything new', async () => {
		const scene = new FakeGlobeScene({ cinematic: true });
		scene.destroy();
		const listener = vi.fn();

		scene.subscribeOrientation(listener);
		scene.subscribeScale(listener);
		scene.subscribeImageryHealth(listener);
		scene.updateStage({ width: 10, height: 10 });

		expect(listener.mock.calls).toEqual([[undefined], [undefined]]);
		expect(scene.liveSubscriptions).toBe(0);
		expect(scene.stages).toEqual([]);
		expect(scene.prepareReveal(TARGET)).toBe(false);
		expect(scene.resetView()).toBe('unavailable');
		await expect(scene.showMountain(TARGET, 'next')).resolves.toEqual({ status: 'interrupted' });
	});

	it('lets a later view-ready wait supersede an earlier one', async () => {
		const scene = new FakeGlobeScene({ holdViewReady: true });
		const first = scene.whenViewReady();
		const second = scene.whenViewReady();
		const settled = vi.fn();
		void second.then(settled);

		await first;
		expect(settled).not.toHaveBeenCalled();

		scene.arriveViewReady();
		await second;
		expect(settled).toHaveBeenCalledTimes(1);
	});
});

describe('FakeSceneFactory', () => {
	it('records create order and lets each create settle independently', async () => {
		const factory = new FakeSceneFactory();
		const signal = new AbortController().signal;
		const first = factory.createScene('token', signal);
		const second = factory.createScene('token', signal);

		const secondScene = factory.resolve(1);
		factory.reject(0, new Error('boom'));

		await expect(second).resolves.toBe(secondScene);
		await expect(first).rejects.toThrow('boom');
		expect(factory.log).toEqual(['create:1', 'create:2']);
	});

	it('logs destruction against the create it answered', async () => {
		const factory = new FakeSceneFactory();
		void factory.createScene('t', new AbortController().signal);

		factory.resolve(0).destroy();

		expect(factory.log).toEqual(['create:1', 'destroy:1']);
	});
});
