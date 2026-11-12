import { describe, expect, it, vi } from 'vitest';
import type { MountainIndexResult } from '../api/contract';
import { MountainIndexStore, type MountainIndexState } from './MountainIndexStore';
import { indexEntry } from '../api/test-support/indexEntries';

const FOUND: MountainIndexResult = {
	kind: 'found',
	mountains: [indexEntry('aconcagua', 'Aconcagua')]
};
const REFRESHED: MountainIndexResult = {
	kind: 'found',
	mountains: [indexEntry('aconcagua', 'Aconcagua'), indexEntry('mont-blanc', 'Mont Blanc')]
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => (resolve = done));
	return { promise, resolve };
}

function storeAnswering(...results: (MountainIndexResult | Promise<MountainIndexResult>)[]) {
	let clock = 0;
	const getMountainIndex = vi.fn(async () => {
		const next = results.shift();
		if (next === undefined) {
			throw new Error('unexpected request');
		}
		return next;
	});
	const store = new MountainIndexStore({
		api: { getMountainIndex },
		now: () => clock,
		maxAgeMs: 1_000
	});
	const states: MountainIndexState['status'][] = [];
	store.subscribe(() => states.push(store.getSnapshot().status));

	return {
		store,
		getMountainIndex,
		states,
		advance: (ms: number) => {
			clock += ms;
		}
	};
}

function slugsOf(state: MountainIndexState): string[] {
	return state.status === 'ready' ? state.mountains.map((mountain) => mountain.slug) : [];
}

describe('MountainIndexStore', () => {
	it('requests nothing until search asks for the index', () => {
		const { store, getMountainIndex } = storeAnswering(FOUND);

		expect(store.getSnapshot()).toEqual({ status: 'idle' });
		expect(getMountainIndex).not.toHaveBeenCalled();
	});

	it('loads the index once and becomes ready', async () => {
		const { store, getMountainIndex, states } = storeAnswering(FOUND);

		await store.request();

		expect(states).toEqual(['loading', 'ready']);
		expect(slugsOf(store.getSnapshot())).toEqual(['aconcagua']);
		expect(getMountainIndex).toHaveBeenCalledTimes(1);
	});

	it('shares one request between overlapping asks', async () => {
		const answer = deferred<MountainIndexResult>();
		const { store, getMountainIndex } = storeAnswering(answer.promise);

		const first = store.request();
		const second = store.request();
		answer.resolve(FOUND);
		await Promise.all([first, second]);

		expect(getMountainIndex).toHaveBeenCalledTimes(1);
	});

	it('reuses a fresh index without requesting it again', async () => {
		const { store, getMountainIndex, advance } = storeAnswering(FOUND);
		await store.request();

		advance(999);
		await store.request();

		expect(getMountainIndex).toHaveBeenCalledTimes(1);
	});

	it('refreshes a stale index in the background, keeping it searchable meanwhile', async () => {
		const answer = deferred<MountainIndexResult>();
		const { store, states, advance } = storeAnswering(FOUND, answer.promise);
		await store.request();
		advance(1_000);

		const refresh = store.request();
		expect(slugsOf(store.getSnapshot())).toEqual(['aconcagua']);
		answer.resolve(REFRESHED);
		await refresh;

		expect(states).toEqual(['loading', 'ready', 'ready']);
		expect(slugsOf(store.getSnapshot())).toEqual(['aconcagua', 'mont-blanc']);
	});

	it('keeps the stale index when a refresh fails and tries again on the next ask', async () => {
		const { store, getMountainIndex, advance } = storeAnswering(
			FOUND,
			{ kind: 'unreachable' },
			REFRESHED
		);
		await store.request();
		advance(1_000);

		await store.request();
		expect(slugsOf(store.getSnapshot())).toEqual(['aconcagua']);

		await store.request();
		expect(slugsOf(store.getSnapshot())).toEqual(['aconcagua', 'mont-blanc']);
		expect(getMountainIndex).toHaveBeenCalledTimes(3);
	});

	it.each([
		[{ kind: 'unreachable' } as const, 'unreachable'],
		[{ kind: 'api-error', status: 500 } as const, 'api-error']
	])('fails with the reason of a %j answer and recovers on retry', async (failure, reason) => {
		const { store } = storeAnswering(failure, FOUND);

		await store.request();
		expect(store.getSnapshot()).toEqual({ status: 'failed', reason });

		await store.request();
		expect(slugsOf(store.getSnapshot())).toEqual(['aconcagua']);
	});

	it('reports an unexpected error and fails as an API error', async () => {
		const onError = vi.fn();
		const error = new Error('NEXT_PUBLIC_API_BASE_URL is missing');
		const store = new MountainIndexStore({
			api: { getMountainIndex: async () => Promise.reject(error) },
			onError
		});

		await store.request();

		expect(store.getSnapshot()).toEqual({ status: 'failed', reason: 'api-error' });
		expect(onError).toHaveBeenCalledWith(error);
	});

	it('is ready with an empty index for an empty catalog', async () => {
		const { store } = storeAnswering({ kind: 'found', mountains: [] });

		await store.request();

		expect(store.getSnapshot()).toEqual({ status: 'ready', mountains: [] });
	});

	it('stops notifying a listener that unsubscribed', async () => {
		const store = new MountainIndexStore({ api: { getMountainIndex: async () => FOUND } });
		const listener = vi.fn();
		store.subscribe(listener)();

		await store.request();

		expect(listener).not.toHaveBeenCalled();
	});

	it('takes a seeded index as fresh, so the next ask makes no request', async () => {
		const { store, getMountainIndex, states, advance } = storeAnswering(REFRESHED);

		store.seed([indexEntry('aconcagua', 'Aconcagua')]);
		advance(999);
		await store.request();

		expect(states).toEqual(['ready']);
		expect(slugsOf(store.getSnapshot())).toEqual(['aconcagua']);
		expect(getMountainIndex).not.toHaveBeenCalled();
	});

	it('refreshes a seeded index once it is older than the maximum age', async () => {
		const { store, getMountainIndex, advance } = storeAnswering(REFRESHED);
		store.seed([indexEntry('aconcagua', 'Aconcagua')]);

		advance(1_000);
		await store.request();

		expect(getMountainIndex).toHaveBeenCalledOnce();
		expect(slugsOf(store.getSnapshot())).toEqual(['aconcagua', 'mont-blanc']);
	});

	it('replaces a failed index with a seeded one', async () => {
		const { store } = storeAnswering({ kind: 'unreachable' });
		await store.request();

		store.seed([indexEntry('mont-blanc', 'Mont Blanc')]);

		expect(slugsOf(store.getSnapshot())).toEqual(['mont-blanc']);
	});
});
