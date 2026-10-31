import { describe, expect, it, vi } from 'vitest';
import { PhotoReveal } from './PhotoReveal';
import { ImagePreloader } from './preload';
import { FakeImage, settle } from './test-support/FakeImage';

const A = { src: 'https://x.test/a/1280px-a.jpg' };
const B = { src: 'https://x.test/b/1280px-b.jpg' };

function setup() {
	const preloader = new ImagePreloader({ create: () => undefined });
	const reveal = new PhotoReveal(preloader);
	const listener = vi.fn();
	reveal.subscribe(listener);

	return { preloader, reveal, listener };
}

describe('PhotoReveal', () => {
	it('starts with nothing tracked and pending', () => {
		const { reveal } = setup();

		expect(reveal.getSnapshot()).toEqual({ source: undefined, status: 'pending' });
	});

	it('stays pending for its source until the image is decoded', async () => {
		const { reveal } = setup();
		const image = new FakeImage();

		reveal.attach(image, A);
		await settle();

		expect(reveal.getSnapshot()).toEqual({ source: A.src, status: 'pending' });

		image.finish(1280, 720);
		await settle();

		expect(reveal.getSnapshot()).toEqual({
			source: A.src,
			status: 'ready',
			dimensions: { width: 1280, height: 720 }
		});
	});

	it('reveals an image that was already cached before it was attached', async () => {
		const { reveal } = setup();
		const image = new FakeImage({ complete: true, naturalWidth: 960, naturalHeight: 640 });

		reveal.attach(image, A);
		await settle();

		expect(reveal.getSnapshot().status).toBe('ready');
	});

	it('fails on a load error', async () => {
		const { reveal } = setup();
		const image = new FakeImage();

		reveal.attach(image, A);
		image.fail();
		await settle();

		expect(reveal.getSnapshot()).toEqual({ source: A.src, status: 'failed' });
	});

	it('fails when the image loaded but cannot be decoded into pixels', async () => {
		const { reveal } = setup();
		const image = new FakeImage({
			complete: true,
			decode: () => Promise.reject(new Error('EncodingError'))
		});

		reveal.attach(image, A);
		await settle();

		expect(reveal.getSnapshot()).toEqual({ source: A.src, status: 'failed' });
	});

	it('never lets a late completion of a superseded image replace the current one', async () => {
		const { reveal } = setup();
		const first = new FakeImage();
		const second = new FakeImage();

		const detachFirst = reveal.attach(first, A);
		detachFirst();
		reveal.attach(second, B);
		first.finish(100, 100);
		await settle();

		expect(reveal.getSnapshot()).toEqual({ source: B.src, status: 'pending' });

		second.finish(1280, 720);
		await settle();

		expect(reveal.getSnapshot()).toMatchObject({ source: B.src, status: 'ready' });
	});

	it('ignores the old image even when it is never detached before the next attach', async () => {
		const { reveal } = setup();
		const first = new FakeImage();
		const second = new FakeImage();

		reveal.attach(first, A);
		reveal.attach(second, B);
		first.fail();
		await settle();

		expect(reveal.getSnapshot()).toEqual({ source: B.src, status: 'pending' });
	});

	it('detaching the current image stops its completion from publishing', async () => {
		const { reveal, listener } = setup();
		const image = new FakeImage();

		const detach = reveal.attach(image, A);
		listener.mockClear();
		detach();
		image.finish();
		await settle();

		expect(listener).not.toHaveBeenCalled();
		expect(reveal.getSnapshot().status).toBe('pending');
	});

	it('retries a source that failed once it is attached again', async () => {
		const { reveal } = setup();
		const broken = new FakeImage();

		reveal.attach(broken, A);
		broken.fail();
		await settle();
		reveal.attach(new FakeImage({ complete: true, naturalWidth: 10, naturalHeight: 10 }), A);
		await settle();

		expect(reveal.getSnapshot().status).toBe('ready');
	});

	it('remembers the measured size in the shared preloader', async () => {
		const { reveal, preloader } = setup();
		const image = new FakeImage();

		reveal.attach(image, A);
		image.finish(1200, 800);
		await settle();

		expect(preloader.dimensionsOf(A)).toEqual({ width: 1200, height: 800 });
	});

	it('does not remember the size of a failed image', async () => {
		const { reveal, preloader } = setup();
		const image = new FakeImage();

		reveal.attach(image, A);
		image.fail();
		await settle();

		expect(preloader.dimensionsOf(A)).toBeUndefined();
	});

	it('does not remember the size of a superseded image', async () => {
		const { reveal, preloader } = setup();
		const first = new FakeImage();

		reveal.attach(first, A);
		reveal.attach(new FakeImage(), B);
		first.finish(1200, 800);
		await settle();

		expect(preloader.dimensionsOf(A)).toBeUndefined();
	});
});
