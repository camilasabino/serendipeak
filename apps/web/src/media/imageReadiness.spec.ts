import { describe, expect, it, vi } from 'vitest';
import { watchImage, type ImageLike, type ImageOutcome } from './imageReadiness';

class FakeImage extends EventTarget implements ImageLike {
	complete = false;
	naturalWidth = 0;
	naturalHeight = 0;
	currentSrc = 'https://example.test/a.jpg';
	decode?: () => Promise<void>;

	constructor(init: Partial<FakeImage> = {}) {
		super();
		Object.assign(this, init);
	}

	finish(width = 1280, height = 853) {
		this.complete = true;
		this.naturalWidth = width;
		this.naturalHeight = height;
		this.dispatchEvent(new Event('load'));
	}

	fail() {
		this.complete = true;
		this.dispatchEvent(new Event('error'));
	}
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function watch(image: ImageLike) {
	const settled = vi.fn<(outcome: ImageOutcome) => void>();
	const cancel = watchImage(image, settled);
	return { settled, cancel };
}

describe('watchImage', () => {
	it('settles an already complete image after it decodes', async () => {
		const decode = vi.fn(() => Promise.resolve());
		const image = new FakeImage({ complete: true, naturalWidth: 960, naturalHeight: 640, decode });
		const { settled } = watch(image);

		expect(settled).not.toHaveBeenCalled();
		await flush();

		expect(decode).toHaveBeenCalledOnce();
		expect(settled).toHaveBeenCalledWith({
			status: 'ready',
			dimensions: { width: 960, height: 640 }
		});
	});

	it('waits for the load event and then decodes', async () => {
		const decode = vi.fn(() => Promise.resolve());
		const image = new FakeImage({ decode });
		const { settled } = watch(image);

		await flush();
		expect(settled).not.toHaveBeenCalled();

		image.finish(1280, 720);
		await flush();

		expect(decode).toHaveBeenCalledOnce();
		expect(settled).toHaveBeenCalledOnce();
		expect(settled).toHaveBeenCalledWith({
			status: 'ready',
			dimensions: { width: 1280, height: 720 }
		});
	});

	it('does not reveal before the decode promise resolves', async () => {
		let resolveDecode: () => void = () => {};
		const image = new FakeImage({
			decode: () => new Promise<void>((resolve) => (resolveDecode = resolve))
		});
		const { settled } = watch(image);

		image.finish();
		await flush();
		expect(settled).not.toHaveBeenCalled();

		resolveDecode();
		await flush();
		expect(settled).toHaveBeenCalledOnce();
	});

	it('falls back to load semantics when decode rejects on a loaded image', async () => {
		const image = new FakeImage({ decode: () => Promise.reject(new Error('EncodingError')) });
		const { settled } = watch(image);

		image.finish();
		await flush();

		expect(settled).toHaveBeenCalledWith({
			status: 'ready',
			dimensions: { width: 1280, height: 853 }
		});
	});

	it('works without decode support', async () => {
		const image = new FakeImage({ complete: true, naturalWidth: 500, naturalHeight: 333 });
		const { settled } = watch(image);

		await flush();

		expect(settled).toHaveBeenCalledWith({
			status: 'ready',
			dimensions: { width: 500, height: 333 }
		});
	});

	it('fails on a network error', async () => {
		const image = new FakeImage({ decode: () => Promise.resolve() });
		const { settled } = watch(image);

		image.fail();
		await flush();

		expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 'failed' });
	});

	it('fails on a complete image with no pixels', () => {
		const image = new FakeImage({ complete: true });
		const { settled } = watch(image);

		expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 'failed' });
	});

	it('fails when decode rejects because the image is broken', async () => {
		const image = new FakeImage({
			complete: true,
			naturalWidth: 0,
			decode: () => Promise.reject(new Error('EncodingError'))
		});
		const { settled } = watch(image);

		await flush();

		expect(settled).toHaveBeenCalledExactlyOnceWith({ status: 'failed' });
	});

	it('keeps waiting when decode rejects while the source is still loading', async () => {
		const image = new FakeImage({
			complete: false,
			decode: () => Promise.reject(new Error('source changed'))
		});
		const { settled } = watch(image);

		image.dispatchEvent(new Event('load'));
		await flush();
		expect(settled).not.toHaveBeenCalled();

		image.finish();
		await flush();
		expect(settled).toHaveBeenCalledOnce();
	});

	it('ignores a completion that arrives after cancel', async () => {
		const image = new FakeImage({ decode: () => Promise.resolve() });
		const { settled, cancel } = watch(image);

		cancel();
		image.finish();
		await flush();

		expect(settled).not.toHaveBeenCalled();
	});

	it('ignores a decode that resolves after cancel', async () => {
		let resolveDecode: () => void = () => {};
		const image = new FakeImage({
			decode: () => new Promise<void>((resolve) => (resolveDecode = resolve))
		});
		const { settled, cancel } = watch(image);

		image.finish();
		cancel();
		resolveDecode();
		await flush();

		expect(settled).not.toHaveBeenCalled();
	});

	it('settles at most once', async () => {
		const image = new FakeImage({ decode: () => Promise.resolve() });
		const { settled } = watch(image);

		image.finish();
		image.finish();
		image.fail();
		await flush();

		expect(settled).toHaveBeenCalledOnce();
	});
});
