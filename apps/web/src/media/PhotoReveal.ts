import { watchImage, type ImageDimensions, type ImageLike } from './imageReadiness';
import type { ImagePreloader } from './preload';
import type { PageRendition } from './renditions';

export type PhotoSnapshot =
	| { source: string | undefined; status: 'pending' }
	| { source: string; status: 'ready'; dimensions: ImageDimensions }
	| { source: string; status: 'failed' };

const IDLE: PhotoSnapshot = { source: undefined, status: 'pending' };

export class PhotoReveal {
	private snapshot: PhotoSnapshot = IDLE;
	private stopWatching: (() => void) | undefined;
	private readonly listeners = new Set<() => void>();

	constructor(private readonly preloader: Pick<ImagePreloader, 'remember'>) {}

	// Arrow properties because React receives them detached (useSyncExternalStore).
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	readonly getSnapshot = (): PhotoSnapshot => this.snapshot;

	// Readiness comes from the displayed element itself. Only the most recent attach may publish.
	attach(image: ImageLike, rendition: PageRendition): () => void {
		this.stopWatching?.();
		this.publish({ source: rendition.src, status: 'pending' });

		const stop = watchImage(image, (outcome) => {
			if (outcome.status === 'failed') {
				this.publish({ source: rendition.src, status: 'failed' });
				return;
			}

			this.preloader.remember(rendition, outcome.dimensions);
			this.publish({ source: rendition.src, status: 'ready', dimensions: outcome.dimensions });
		});
		this.stopWatching = stop;

		return () => {
			stop();
			if (this.stopWatching === stop) {
				this.stopWatching = undefined;
			}
		};
	}

	private publish(snapshot: PhotoSnapshot): void {
		this.snapshot = snapshot;
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}
