import type { ImageLike } from '../imageReadiness';

export class FakeImage extends EventTarget implements ImageLike {
	complete = false;
	naturalWidth = 0;
	naturalHeight = 0;
	currentSrc = '';
	decode: () => Promise<void> = () => Promise.resolve();

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

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
