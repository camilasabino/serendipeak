import { describe, expect, it, vi } from 'vitest';
import { ImageryMonitor } from './imageryMonitor';

function createEvent<T>() {
	const listeners = new Set<(value: T) => void>();
	return {
		addEventListener(listener: (value: T) => void) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		raise(value: T) {
			for (const listener of [...listeners]) {
				listener(value);
			}
		},
		get count() {
			return listeners.size;
		}
	};
}

function createLayer() {
	const providerErrors = createEvent<unknown>();
	const provider = { errorEvent: providerErrors };
	const layerErrors = createEvent<unknown>();
	const ready = createEvent<typeof provider>();
	return {
		layer: { errorEvent: layerErrors, readyEvent: ready },
		provider,
		layerErrors,
		ready,
		providerErrors
	};
}

function setup() {
	const fake = createLayer();
	let clock = 0;
	const onDegraded = vi.fn();
	const onLayerFailed = vi.fn();
	const monitor = new ImageryMonitor(fake.layer, {
		now: () => clock,
		onDegraded,
		onLayerFailed
	});
	const states: boolean[] = [];
	monitor.subscribe((degraded) => states.push(degraded));
	return {
		...fake,
		monitor,
		states,
		onDegraded,
		onLayerFailed,
		at(time: number) {
			clock = time;
		}
	};
}

describe('ImageryMonitor', () => {
	it('does nothing when there is no imagery layer', () => {
		const monitor = new ImageryMonitor(false);
		const listener = vi.fn();

		expect(monitor.degraded).toBe(false);
		expect(monitor.subscribe(listener)).toBeTypeOf('function');
		monitor.release();
		expect(listener).not.toHaveBeenCalled();
	});

	it('never reports a layer failure when there is no imagery layer', () => {
		const onLayerFailed = vi.fn();

		new ImageryMonitor(false, { onLayerFailed }).release();

		expect(onLayerFailed).not.toHaveBeenCalled();
	});

	it('subscribes to the layer events and not yet to the provider', () => {
		const { layerErrors, ready, providerErrors } = setup();

		expect(layerErrors.count).toBe(1);
		expect(ready.count).toBe(1);
		expect(providerErrors.count).toBe(0);
	});

	it('attaches the provider listener only once the provider is ready', () => {
		const { ready, provider, providerErrors } = setup();

		ready.raise(provider);

		expect(providerErrors.count).toBe(1);
	});

	it('degrades as soon as the layer fails to be created', () => {
		const { layerErrors, monitor, states, onDegraded } = setup();

		layerErrors.raise(new Error('creation failed'));

		expect(monitor.degraded).toBe(true);
		expect(states).toEqual([true]);
		expect(onDegraded).toHaveBeenCalledOnce();
	});

	it('reports a layer creation failure exactly once', () => {
		const { layerErrors, onLayerFailed } = setup();

		layerErrors.raise(new Error('creation failed'));
		layerErrors.raise(new Error('creation failed again'));

		expect(onLayerFailed).toHaveBeenCalledOnce();
	});

	it('does not report a layer failure for a healthy layer', () => {
		const { ready, provider, onLayerFailed } = setup();

		ready.raise(provider);

		expect(onLayerFailed).not.toHaveBeenCalled();
	});

	it('does not report a layer failure for runtime provider degradation', () => {
		const { ready, provider, providerErrors, monitor, onLayerFailed, onDegraded } = setup();
		ready.raise(provider);

		providerErrors.raise({ error: { statusCode: 403 } });
		providerErrors.raise({ error: { statusCode: 429 } });

		expect(monitor.degraded).toBe(true);
		expect(onDegraded).toHaveBeenCalledOnce();
		expect(onLayerFailed).not.toHaveBeenCalled();
	});

	it('clears a pre-ready layer failure when the provider becomes ready', () => {
		const { layerErrors, ready, provider, monitor, states } = setup();

		layerErrors.raise(new Error('creation failed'));
		ready.raise(provider);

		expect(monitor.degraded).toBe(false);
		expect(states).toEqual([true, false]);
	});

	it('ignores one isolated provider error', () => {
		const { ready, provider, providerErrors, monitor, states } = setup();
		ready.raise(provider);

		providerErrors.raise({ error: { statusCode: 404 } });

		expect(monitor.degraded).toBe(false);
		expect(states).toEqual([]);
	});

	it.each([401, 403, 429])('degrades immediately on provider HTTP %i', (statusCode) => {
		const { ready, provider, providerErrors, monitor, states } = setup();
		ready.raise(provider);

		providerErrors.raise({ error: { statusCode } });

		expect(monitor.degraded).toBe(true);
		expect(states).toEqual([true]);
	});

	it('degrades after three generic provider errors inside eight seconds', () => {
		const { ready, provider, providerErrors, monitor, at } = setup();
		ready.raise(provider);

		at(0);
		providerErrors.raise(new Error('tile'));
		at(3000);
		providerErrors.raise(new Error('tile'));
		expect(monitor.degraded).toBe(false);
		at(7000);
		providerErrors.raise(new Error('tile'));

		expect(monitor.degraded).toBe(true);
	});

	it('stays degraded and silent on later errors and on a later ready signal', () => {
		const { ready, provider, providerErrors, states, onDegraded } = setup();
		ready.raise(provider);

		providerErrors.raise({ error: { statusCode: 429 } });
		providerErrors.raise({ error: { statusCode: 429 } });
		providerErrors.raise(new Error('tile'));
		ready.raise(provider);

		expect(states).toEqual([true]);
		expect(onDegraded).toHaveBeenCalledOnce();
	});

	it('tells a late subscriber about an existing degradation', () => {
		const { layerErrors, monitor } = setup();
		layerErrors.raise(new Error('creation failed'));
		const late = vi.fn();

		monitor.subscribe(late);

		expect(late).toHaveBeenCalledExactlyOnceWith(true);
	});

	it('does not notify a late subscriber while healthy', () => {
		const { monitor } = setup();
		const late = vi.fn();

		monitor.subscribe(late);

		expect(late).not.toHaveBeenCalled();
	});

	it('stops notifying a subscriber that unsubscribed', () => {
		const { layerErrors, monitor } = setup();
		const listener = vi.fn();
		const unsubscribe = monitor.subscribe(listener);

		unsubscribe();
		layerErrors.raise(new Error('creation failed'));

		expect(listener).not.toHaveBeenCalled();
	});

	it('releases every Cesium listener', () => {
		const { layerErrors, ready, provider, providerErrors, monitor } = setup();
		ready.raise(provider);

		monitor.release();

		expect(layerErrors.count).toBe(0);
		expect(ready.count).toBe(0);
		expect(providerErrors.count).toBe(0);
	});

	it('ignores events delivered after release', () => {
		const { layerErrors, ready, provider, providerErrors, monitor, states, onDegraded } = setup();
		ready.raise(provider);
		monitor.release();

		layerErrors.raise(new Error('late'));
		providerErrors.raise({ error: { statusCode: 403 } });
		ready.raise(provider);

		expect(monitor.degraded).toBe(false);
		expect(states).toEqual([]);
		expect(onDegraded).not.toHaveBeenCalled();
		expect(providerErrors.count).toBe(0);
	});

	it('does not report a layer failure delivered after release', () => {
		const { layerErrors, monitor, onLayerFailed } = setup();
		monitor.release();

		layerErrors.raise(new Error('late'));

		expect(onLayerFailed).not.toHaveBeenCalled();
	});

	it('does not attach a provider listener when the provider is ready after release', () => {
		const { ready, provider, providerErrors, monitor } = setup();
		const lateReady = ready.addEventListener(() => {});
		monitor.release();

		ready.raise(provider);

		expect(providerErrors.count).toBe(0);
		lateReady();
	});

	it('keeps a single provider listener if the provider reports ready twice', () => {
		const { ready, provider, providerErrors } = setup();

		ready.raise(provider);
		ready.raise(provider);

		expect(providerErrors.count).toBe(1);
	});

	it('keeps monitors of two layers independent', () => {
		const first = setup();
		const second = setup();

		first.layerErrors.raise(new Error('creation failed'));

		expect(first.monitor.degraded).toBe(true);
		expect(second.monitor.degraded).toBe(false);
		expect(second.states).toEqual([]);
	});
});
