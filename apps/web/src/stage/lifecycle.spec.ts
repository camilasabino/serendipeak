import { describe, it, expect, vi } from 'vitest';
import { startScene, type Destroyable } from './lifecycle';

function createDeferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

function createScene() {
	const destroy = vi.fn();
	const scene: Destroyable = { destroy };
	return { scene, destroy };
}

describe('startScene', () => {
	it('destroys the scene once when stopped after it is ready', async () => {
		const { scene, destroy } = createScene();
		const stop = startScene(async () => scene, vi.fn());
		await Promise.resolve();

		stop();
		stop();

		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it('destroys a scene that becomes ready after the component was stopped', async () => {
		const deferred = createDeferred<Destroyable>();
		const { scene, destroy } = createScene();
		const stop = startScene(() => deferred.promise, vi.fn());

		stop();
		expect(destroy).not.toHaveBeenCalled();

		deferred.resolve(scene);
		await deferred.promise;

		expect(destroy).toHaveBeenCalledTimes(1);
	});

	it('does not destroy anything when stopped before a failed creation', async () => {
		const deferred = createDeferred<Destroyable>();
		const onError = vi.fn();
		const stop = startScene(() => deferred.promise, onError);

		stop();
		deferred.reject(new Error('boom'));
		await deferred.promise.catch(() => {});

		expect(onError).not.toHaveBeenCalled();
	});

	it('hands the scene to onReady when it becomes ready while active', async () => {
		const { scene } = createScene();
		const onReady = vi.fn();

		startScene(async () => scene, vi.fn(), onReady);
		await Promise.resolve();
		await Promise.resolve();

		expect(onReady).toHaveBeenCalledExactlyOnceWith(scene);
	});

	it('does not call onReady for a scene that becomes ready after stop', async () => {
		const deferred = createDeferred<Destroyable>();
		const { scene } = createScene();
		const onReady = vi.fn();
		const stop = startScene(() => deferred.promise, vi.fn(), onReady);

		stop();
		deferred.resolve(scene);
		await deferred.promise;

		expect(onReady).not.toHaveBeenCalled();
	});

	it('aborts the signal handed to create when stopped', () => {
		const deferred = createDeferred<Destroyable>();
		let received: AbortSignal | undefined;
		const stop = startScene((signal) => {
			received = signal;
			return deferred.promise;
		}, vi.fn());

		expect(received?.aborted).toBe(false);
		stop();

		expect(received?.aborted).toBe(true);
	});

	it('reports a creation failure while the component is active', async () => {
		const failure = new Error('boom');
		const onError = vi.fn();

		startScene(async () => {
			throw failure;
		}, onError);
		await Promise.resolve();
		await Promise.resolve();

		expect(onError).toHaveBeenCalledExactlyOnceWith(failure);
	});
});
