import { describe, expect, it, vi } from 'vitest';
import {
	fullscreenSupported,
	isStageFullscreen,
	subscribeFullscreenChange,
	toggleFullscreen,
	type FullscreenDocument,
	type FullscreenStage
} from './fullscreen';

class FakeDocument extends EventTarget {
	fullscreenEnabled = true;
	fullscreenElement: Element | null = null;
	exitCalls = 0;
	exitFailure: Error | undefined;

	exitFullscreen = async (): Promise<void> => {
		this.exitCalls += 1;
		if (this.exitFailure) {
			throw this.exitFailure;
		}
		this.fullscreenElement = null;
		this.dispatchEvent(new Event('fullscreenchange'));
	};
}

class FakeStage implements FullscreenStage {
	requestCalls = 0;
	requestFailure: Error | undefined;

	constructor(private readonly doc: FakeDocument) {}

	requestFullscreen = async (): Promise<void> => {
		this.requestCalls += 1;
		if (this.requestFailure) {
			throw this.requestFailure;
		}
		this.doc.fullscreenElement = this as unknown as Element;
		this.doc.dispatchEvent(new Event('fullscreenchange'));
	};
}

function setup() {
	const doc = new FakeDocument();
	const stage = new FakeStage(doc);

	return { doc, stage, document: doc as unknown as FullscreenDocument };
}

describe('fullscreenSupported', () => {
	it('follows the document', () => {
		const { doc, document } = setup();

		expect(fullscreenSupported(document)).toBe(true);
		doc.fullscreenEnabled = false;
		expect(fullscreenSupported(document)).toBe(false);
	});

	it('is false where the API does not exist', () => {
		expect(fullscreenSupported({} as FullscreenDocument)).toBe(false);
	});
});

describe('isStageFullscreen', () => {
	it('is true only when the stage itself is the fullscreen element', () => {
		const { doc, stage, document } = setup();

		expect(isStageFullscreen(document, stage)).toBe(false);
		doc.fullscreenElement = {} as Element;
		expect(isStageFullscreen(document, stage)).toBe(false);
		doc.fullscreenElement = stage as unknown as Element;
		expect(isStageFullscreen(document, stage)).toBe(true);
	});

	it('is false before the stage element exists', () => {
		const { document } = setup();

		expect(isStageFullscreen(document, null)).toBe(false);
	});
});

describe('toggleFullscreen', () => {
	it('requests fullscreen on the stage and exits through the document', async () => {
		const { doc, stage, document } = setup();

		await toggleFullscreen(document, stage);
		expect(stage.requestCalls).toBe(1);
		expect(isStageFullscreen(document, stage)).toBe(true);

		await toggleFullscreen(document, stage);
		expect(doc.exitCalls).toBe(1);
		expect(isStageFullscreen(document, stage)).toBe(false);
	});

	it('requests fullscreen when something else is fullscreen', async () => {
		const { doc, stage, document } = setup();
		doc.fullscreenElement = {} as Element;

		await toggleFullscreen(document, stage);

		expect(stage.requestCalls).toBe(1);
		expect(doc.exitCalls).toBe(0);
	});

	it('keeps the document state when the request is rejected', async () => {
		const { stage, document } = setup();
		stage.requestFailure = new TypeError('Permissions check failed');

		await expect(toggleFullscreen(document, stage)).resolves.toBeUndefined();

		expect(isStageFullscreen(document, stage)).toBe(false);
	});

	it('keeps the document state when leaving is rejected', async () => {
		const { doc, stage, document } = setup();
		await toggleFullscreen(document, stage);
		doc.exitFailure = new TypeError('Document not active');

		await expect(toggleFullscreen(document, stage)).resolves.toBeUndefined();

		expect(isStageFullscreen(document, stage)).toBe(true);
	});

	it('does not touch fullscreen state itself: only the document decides', async () => {
		const { doc, stage, document } = setup();
		stage.requestFullscreen = async () => {
			stage.requestCalls += 1;
		};

		await toggleFullscreen(document, stage);

		expect(doc.fullscreenElement).toBeNull();
		expect(isStageFullscreen(document, stage)).toBe(false);
	});
});

describe('subscribeFullscreenChange', () => {
	it('notifies on every fullscreenchange, including ones the page did not start', () => {
		const { doc, stage, document } = setup();
		const onChange = vi.fn();
		subscribeFullscreenChange(document, onChange);

		doc.fullscreenElement = stage as unknown as Element;
		doc.dispatchEvent(new Event('fullscreenchange'));
		doc.fullscreenElement = null;
		doc.dispatchEvent(new Event('fullscreenchange'));

		expect(onChange).toHaveBeenCalledTimes(2);
	});

	it('removes its listener on cleanup', () => {
		const { doc, document } = setup();
		const onChange = vi.fn();
		const unsubscribe = subscribeFullscreenChange(document, onChange);

		unsubscribe();
		doc.dispatchEvent(new Event('fullscreenchange'));

		expect(onChange).not.toHaveBeenCalled();
	});
});
