import { describe, expect, it, vi } from 'vitest';
import { FailedLayerRemoval } from './failedLayerRemoval';
import { ImageryMonitor } from './imageryMonitor';

function setup() {
	const layer = { name: 'base' };
	const collection = { remove: vi.fn(() => true) };
	return { layer, collection, removal: new FailedLayerRemoval(layer) };
}

describe('FailedLayerRemoval', () => {
	it('keeps a healthy layer attached', () => {
		const { collection, removal } = setup();

		removal.attach(collection);

		expect(collection.remove).not.toHaveBeenCalled();
		expect(removal.removed).toBe(false);
	});

	it('removes and destroys the layer when it fails after attachment', () => {
		const { layer, collection, removal } = setup();
		removal.attach(collection);

		removal.layerFailed();

		expect(collection.remove).toHaveBeenCalledExactlyOnceWith(layer, true);
		expect(removal.removed).toBe(true);
	});

	it('removes the layer exactly once when the failure is reported repeatedly', () => {
		const { collection, removal } = setup();
		removal.attach(collection);

		removal.layerFailed();
		removal.layerFailed();
		removal.attach(collection);

		expect(collection.remove).toHaveBeenCalledOnce();
	});

	it('removes a layer that failed before the collection existed once it is attached', () => {
		const { layer, collection, removal } = setup();

		removal.layerFailed();
		expect(collection.remove).not.toHaveBeenCalled();
		expect(removal.removed).toBe(false);
		removal.attach(collection);

		expect(collection.remove).toHaveBeenCalledExactlyOnceWith(layer, true);
		expect(removal.removed).toBe(true);
	});

	it('does not touch the collection when the failure arrives after release', () => {
		const { collection, removal } = setup();
		removal.attach(collection);
		removal.release();

		removal.layerFailed();

		expect(collection.remove).not.toHaveBeenCalled();
		expect(removal.removed).toBe(false);
	});

	it('does not remove a layer that failed before release and attaches afterwards', () => {
		const { collection, removal } = setup();
		removal.layerFailed();
		removal.release();

		removal.attach(collection);

		expect(collection.remove).not.toHaveBeenCalled();
	});
});

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
		}
	};
}

function wired() {
	const providerErrors = createEvent<unknown>();
	const provider = { errorEvent: providerErrors };
	const layer = {
		errorEvent: createEvent<unknown>(),
		readyEvent: createEvent<typeof provider>()
	};
	const collection = { remove: vi.fn(() => true) };
	const removal = new FailedLayerRemoval(layer);
	const monitor = new ImageryMonitor(layer, { onLayerFailed: () => removal.layerFailed() });
	return { layer, provider, providerErrors, collection, removal, monitor };
}

describe('failed layer removal wired to the imagery monitor', () => {
	it('removes the layer when creation fails after attachment', () => {
		const { layer, collection, removal, monitor } = wired();
		removal.attach(collection);

		layer.errorEvent.raise(new Error('creation failed'));

		expect(monitor.degraded).toBe(true);
		expect(collection.remove).toHaveBeenCalledExactlyOnceWith(layer, true);
	});

	it('removes the layer on attachment when creation failed before the collection existed', () => {
		const { layer, collection, removal, monitor } = wired();

		layer.errorEvent.raise(new Error('creation failed'));
		removal.attach(collection);

		expect(monitor.degraded).toBe(true);
		expect(collection.remove).toHaveBeenCalledExactlyOnceWith(layer, true);
	});

	it('keeps a healthy layer attached', () => {
		const { layer, provider, collection, removal, monitor } = wired();
		removal.attach(collection);

		layer.readyEvent.raise(provider);

		expect(monitor.degraded).toBe(false);
		expect(collection.remove).not.toHaveBeenCalled();
	});

	it('keeps the layer attached on runtime degradation after the provider was ready', () => {
		const { layer, provider, providerErrors, collection, removal, monitor } = wired();
		removal.attach(collection);
		layer.readyEvent.raise(provider);

		providerErrors.raise({ error: { statusCode: 403 } });

		expect(monitor.degraded).toBe(true);
		expect(collection.remove).not.toHaveBeenCalled();
		expect(removal.removed).toBe(false);
	});

	it('ignores a creation failure delivered after the scene was destroyed', () => {
		const { layer, collection, removal, monitor } = wired();
		removal.attach(collection);
		monitor.release();
		removal.release();

		layer.errorEvent.raise(new Error('late'));

		expect(collection.remove).not.toHaveBeenCalled();
	});
});
