import type { MountainImage } from '../api/contract';
import { watchImage, type ImageDimensions, type ImageLike } from './imageReadiness';
import { pageRendition, type PageRendition } from './renditions';

export interface PreloadableImage extends ImageLike {
	src: string;
}

interface PreloaderOptions {
	create?: () => PreloadableImage | undefined;
	limit?: number;
}

interface Entry {
	image?: PreloadableImage;
	dimensions?: ImageDimensions;
	cancel?: () => void;
}

const DEFAULT_LIMIT = 8;

function createBrowserImage(): PreloadableImage | undefined {
	return typeof Image === 'undefined' ? undefined : new Image();
}

function identity({ src }: PageRendition): string {
	return src;
}

export class ImagePreloader {
	private readonly entries = new Map<string, Entry>();
	private readonly create: () => PreloadableImage | undefined;
	private readonly limit: number;

	constructor({ create = createBrowserImage, limit = DEFAULT_LIMIT }: PreloaderOptions = {}) {
		this.create = create;
		this.limit = limit;
	}

	preload(target: PageRendition): void {
		const key = identity(target);

		if (this.entries.has(key)) {
			return;
		}

		const image = this.create();

		if (!image) {
			return;
		}

		const entry: Entry = { image };

		this.entries.set(key, entry);
		this.evict();

		image.src = target.src;
		entry.cancel = watchImage(image, (outcome) => {
			entry.cancel = undefined;

			if (outcome.status === 'ready') {
				entry.dimensions = outcome.dimensions;
			}
		});
	}

	remember(target: PageRendition, dimensions: ImageDimensions): void {
		const key = identity(target);
		const entry = this.entries.get(key) ?? {};

		entry.dimensions = dimensions;
		this.entries.delete(key);
		this.entries.set(key, entry);
		this.evict();
	}

	dimensionsOf(target: PageRendition): ImageDimensions | undefined {
		return this.entries.get(identity(target))?.dimensions;
	}

	private evict(): void {
		while (this.entries.size > this.limit) {
			const oldest = this.entries.keys().next().value;

			if (oldest === undefined) {
				return;
			}

			this.entries.get(oldest)?.cancel?.();
			this.entries.delete(oldest);
		}
	}
}

export function prefetchPrimaryImage(preloader: ImagePreloader, image: MountainImage | undefined) {
	if (image) {
		preloader.preload(pageRendition(image));
	}
}
