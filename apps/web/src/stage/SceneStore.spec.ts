import { describe, expect, it, vi } from 'vitest';
import { SceneStore } from './SceneStore';

describe('SceneStore', () => {
	it('starts loading with nothing measured', () => {
		expect(new SceneStore().getSnapshot()).toEqual({
			state: { status: 'loading' },
			headingDegrees: undefined,
			scale: undefined,
			settled: false,
			free: false,
			rotation: 'off'
		});
	});

	it('publishes free navigation only when it changes', () => {
		const store = new SceneStore();
		const listener = vi.fn();
		store.subscribe(listener);

		store.setFree(true);
		store.setFree(true);
		store.setFree(false);

		expect(listener).toHaveBeenCalledTimes(2);
		expect(store.getSnapshot().free).toBe(false);
	});

	it('works when subscribe and getSnapshot are passed around detached', () => {
		const store = new SceneStore();
		const { subscribe, getSnapshot } = store;
		const listener = vi.fn();

		const unsubscribe = subscribe(listener);
		store.setState({ status: 'ready' });

		expect(listener).toHaveBeenCalledTimes(1);
		expect(getSnapshot().state).toEqual({ status: 'ready' });

		unsubscribe();
		store.setSettled(true);

		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('keeps the same snapshot object when nothing meaningful changed', () => {
		const store = new SceneStore();
		const listener = vi.fn();
		store.subscribe(listener);
		store.setState({ status: 'ready', imageryDegraded: true });
		const before = store.getSnapshot();

		store.setState({ status: 'ready', imageryDegraded: true });
		store.setSettled(false);
		store.setOrientation(undefined);
		store.setScale(undefined);

		expect(store.getSnapshot()).toBe(before);
		expect(listener).toHaveBeenCalledTimes(1);
	});

	it('replaces the snapshot when the imagery degradation latch changes', () => {
		const store = new SceneStore();
		store.setState({ status: 'ready' });
		const plain = store.getSnapshot();

		store.setState({ status: 'ready', imageryDegraded: true });

		expect(store.getSnapshot()).not.toBe(plain);
		expect(store.getSnapshot().state).toEqual({ status: 'ready', imageryDegraded: true });
	});

	it('publishes the heading as a whole degree and ignores sub-degree jitter', () => {
		const store = new SceneStore();
		const listener = vi.fn();
		store.subscribe(listener);

		store.setOrientation({ viewHeadingDegrees: 89.6 });
		store.setOrientation({ viewHeadingDegrees: 90.4 });

		expect(store.getSnapshot().headingDegrees).toBe(90);
		expect(listener).toHaveBeenCalledTimes(1);

		store.setOrientation({ viewHeadingDegrees: 359.7 });
		expect(store.getSnapshot().headingDegrees).toBe(0);
	});

	it('treats a non-finite heading as unknown', () => {
		const store = new SceneStore();
		store.setOrientation({ viewHeadingDegrees: 10 });

		store.setOrientation({ viewHeadingDegrees: Number.NaN });

		expect(store.getSnapshot().headingDegrees).toBeUndefined();
	});

	it('replaces the scale only when the label or the rounded width changes', () => {
		const store = new SceneStore();
		const listener = vi.fn();
		store.subscribe(listener);

		store.setScale({ label: '5 km', meters: 5000, widthPx: 80.2 });
		store.setScale({ label: '5 km', meters: 5001, widthPx: 80.4 });
		expect(listener).toHaveBeenCalledTimes(1);

		store.setScale({ label: '5 km', meters: 5200, widthPx: 83 });
		store.setScale({ label: '10 km', meters: 10_000, widthPx: 83 });
		expect(listener).toHaveBeenCalledTimes(3);
		expect(store.getSnapshot().scale?.label).toBe('10 km');
	});

	it('reports a failed state once and by its failure', () => {
		const store = new SceneStore();
		const listener = vi.fn();
		store.subscribe(listener);
		const failed = {
			status: 'failed',
			failure: 'initialization-failed',
			message: 'The 3D globe could not be loaded.'
		} as const;

		store.setState(failed);
		store.setState({ ...failed });
		store.setState({ status: 'failed', failure: 'missing-token', message: 'no token' });

		expect(listener).toHaveBeenCalledTimes(2);
	});

	it('lets a listener unsubscribe while being notified', () => {
		const store = new SceneStore();
		const seen: string[] = [];
		const stop = store.subscribe(() => {
			seen.push('first');
			stop();
		});
		store.subscribe(() => seen.push('second'));

		store.setSettled(true);
		store.setSettled(false);

		expect(seen).toEqual(['first', 'second', 'second']);
	});
});
