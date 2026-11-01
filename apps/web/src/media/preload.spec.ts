import { describe, expect, it } from 'vitest';
import type { MountainImage } from '../api/contract';
import { ImagePreloader, prefetchPrimaryImage, type PreloadableImage } from './preload';

class FakeImage extends EventTarget implements PreloadableImage {
	complete = false;
	naturalWidth = 0;
	naturalHeight = 0;
	currentSrc = '';
	private current = '';
	order: string[] = [];

	get src() {
		return this.current;
	}

	set src(value: string) {
		this.order.push('src');
		this.current = value;
		this.currentSrc = value;
	}

	decode = () => Promise.resolve();

	finish(width = 960, height = 640) {
		this.complete = true;
		this.naturalWidth = width;
		this.naturalHeight = height;
		this.dispatchEvent(new Event('load'));
	}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const target = { src: 'https://x.test/1280.jpg' };

function setup(limit?: number) {
	const created: FakeImage[] = [];
	const preloader = new ImagePreloader({
		create: () => {
			const image = new FakeImage();
			created.push(image);
			return image;
		},
		limit
	});
	return { created, preloader };
}

describe('ImagePreloader', () => {
	it('starts the request with the same src the page image uses', () => {
		const { created, preloader } = setup();

		preloader.preload(target);

		expect(created).toHaveLength(1);
		expect(created[0]!.src).toBe('https://x.test/1280.jpg');
	});

	it('does not start the same request twice', () => {
		const { created, preloader } = setup();

		preloader.preload(target);
		preloader.preload({ ...target });

		expect(created).toHaveLength(1);
	});

	it('records dimensions once the image has decoded', async () => {
		const { created, preloader } = setup();

		preloader.preload(target);
		expect(preloader.dimensionsOf(target)).toBe(undefined);

		created[0]!.finish(960, 640);
		await flush();

		expect(preloader.dimensionsOf(target)).toEqual({ width: 960, height: 640 });
	});

	it('remembers dimensions reported by a rendered image', () => {
		const { preloader } = setup();

		preloader.remember(target, { width: 800, height: 1200 });

		expect(preloader.dimensionsOf(target)).toEqual({ width: 800, height: 1200 });
	});

	it('keeps only the most recent entries', () => {
		const { preloader } = setup(2);

		preloader.preload({ src: 'a' });
		preloader.preload({ src: 'b' });
		preloader.preload({ src: 'c' });
		preloader.remember({ src: 'a' }, { width: 1, height: 1 });
		preloader.remember({ src: 'b' }, { width: 2, height: 2 });

		expect(preloader.dimensionsOf({ src: 'c' })).toBe(undefined);
		expect(preloader.dimensionsOf({ src: 'a' })).toEqual({ width: 1, height: 1 });
	});

	it('ignores an image that fails and does not throw', async () => {
		const { created, preloader } = setup();

		preloader.preload(target);
		created[0]!.dispatchEvent(new Event('error'));
		await flush();

		expect(preloader.dimensionsOf(target)).toBe(undefined);
	});

	it('does nothing where images cannot be created', () => {
		const preloader = new ImagePreloader({ create: () => undefined });

		expect(() => preloader.preload(target)).not.toThrow();
	});
});

describe('prefetchPrimaryImage', () => {
	it('accepts a mountain without a photograph', () => {
		expect(() => prefetchPrimaryImage(new ImagePreloader(), undefined)).not.toThrow();
	});

	it('does nothing outside a browser', () => {
		const image: MountainImage = {
			url: 'https://upload.wikimedia.org/a.jpg',
			attribution: 'Someone',
			sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:A.jpg',
			sourceIdentifier: 'File:A.jpg'
		};

		expect(() => prefetchPrimaryImage(new ImagePreloader(), image)).not.toThrow();
	});
});
