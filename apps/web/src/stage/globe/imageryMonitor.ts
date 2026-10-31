import { ImageryHealth } from './imageryHealth';

interface Subscribable<T> {
	addEventListener(listener: (value: T) => void): () => void;
}

interface MonitoredProvider {
	errorEvent: Subscribable<unknown>;
}

export interface MonitoredLayer {
	errorEvent: Subscribable<unknown>;
	readyEvent: Subscribable<MonitoredProvider>;
}

interface MonitorOptions {
	now?: () => number;
	onDegraded?: () => void;
	onLayerFailed?: () => void;
}

export class ImageryMonitor {
	private readonly health = new ImageryHealth();
	private readonly listeners = new Set<(degraded: boolean) => void>();
	private readonly now: () => number;
	private readonly onDegraded: (() => void) | undefined;
	private readonly onLayerFailed: (() => void) | undefined;
	private readonly inert: boolean;
	private released = false;
	private layerFailureReported = false;
	private releaseLayerErrors = () => {};
	private releaseReady = () => {};
	private releaseProvider = () => {};

	constructor(
		layer: MonitoredLayer | false,
		{ now = () => performance.now(), onDegraded, onLayerFailed }: MonitorOptions = {}
	) {
		this.now = now;
		this.onDegraded = onDegraded;
		this.onLayerFailed = onLayerFailed;
		this.inert = !layer;

		if (!layer) {
			return;
		}

		this.releaseLayerErrors = layer.errorEvent.addEventListener(() => this.handleLayerError());
		this.releaseReady = layer.readyEvent.addEventListener((provider) =>
			this.handleProviderReady(provider)
		);
	}

	get degraded(): boolean {
		return !this.inert && !this.released && this.health.degraded;
	}

	subscribe(listener: (degraded: boolean) => void): () => void {
		if (this.inert || this.released) {
			return () => {};
		}
		this.listeners.add(listener);
		if (this.health.degraded) {
			listener(true);
		}
		return () => {
			this.listeners.delete(listener);
		};
	}

	release(): void {
		if (this.inert || this.released) {
			return;
		}
		this.released = true;
		this.releaseLayerErrors();
		this.releaseReady();
		this.releaseProvider();
		this.releaseProvider = () => {};
		this.listeners.clear();
	}

	private publish(degraded: boolean): void {
		for (const listener of [...this.listeners]) {
			listener(degraded);
		}
	}

	private handleLayerError(): void {
		if (this.released) {
			return;
		}
		if (!this.layerFailureReported) {
			this.layerFailureReported = true;
			this.onLayerFailed?.();
		}
		if (this.health.layerFailed()) {
			this.onDegraded?.();
			this.publish(true);
		}
	}

	private handleProviderReady(provider: MonitoredProvider): void {
		if (this.released) {
			return;
		}
		this.releaseProvider();
		this.releaseProvider = provider.errorEvent.addEventListener((error) => {
			if (this.released) {
				return;
			}
			if (this.health.providerError(error, this.now())) {
				this.onDegraded?.();
				this.publish(true);
			}
		});
		if (this.health.providerReady()) {
			this.publish(false);
		}
	}
}
