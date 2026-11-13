import { describe, expect, it, vi } from 'vitest';
import { MARKER_HIT, type HitTarget } from '../markerHits';
import type { MarkerActivation } from '../markerActivation';
import { AtlasPicker, type PickableMarkers } from './AtlasPicker';
import type { CesiumModule } from './CesiumModule';

const LEFT_CLICK = 2;

class FakeHandler {
	static readonly live = new Set<FakeHandler>();
	readonly actions = new Map<number, (event: { position: { x: number; y: number } }) => void>();
	private destroyed = false;

	constructor(readonly element: EventTarget) {
		FakeHandler.live.add(this);
	}

	setInputAction(action: (event: { position: { x: number; y: number } }) => void, type: number) {
		this.actions.set(type, action);
	}

	isDestroyed() {
		return this.destroyed;
	}

	destroy() {
		this.destroyed = true;
		FakeHandler.live.delete(this);
	}

	/** What Cesium reports for a press and release that moved less than its drag threshold. */
	click(x: number, y: number) {
		this.actions.get(LEFT_CLICK)?.({ position: { x, y } });
	}
}

const FAKE_CESIUM = {
	ScreenSpaceEventHandler: FakeHandler,
	ScreenSpaceEventType: { LEFT_CLICK }
} as unknown as CesiumModule;

// The canvas sits 30 px from the left and 50 px from the top of the window.
const CANVAS_LEFT = 30;
const CANVAS_TOP = 50;

class FakeCanvas extends EventTarget {
	readonly style = { cursor: '' };
	readonly listening = new Map<string, number>();

	getBoundingClientRect() {
		return { left: CANVAS_LEFT, top: CANVAS_TOP };
	}

	override addEventListener(type: string, ...rest: [never, never]) {
		this.listening.set(type, (this.listening.get(type) ?? 0) + 1);
		super.addEventListener(type, ...rest);
	}

	override removeEventListener(type: string, ...rest: [never, never]) {
		this.listening.set(type, (this.listening.get(type) ?? 1) - 1);
		super.removeEventListener(type, ...rest);
	}

	pointer(type: string, init: { pointerType?: string; buttons?: number; x?: number; y?: number }) {
		const { pointerType = 'mouse', buttons = 0, x = 0, y = 0 } = init;
		this.dispatchEvent(
			Object.assign(new Event(type), {
				pointerType,
				buttons,
				clientX: CANVAS_LEFT + x,
				clientY: CANVAS_TOP + y
			})
		);
	}

	get liveListeners(): number {
		return [...this.listening.values()].reduce((sum, count) => sum + count, 0);
	}
}

function target(slug: string, x: number, y: number, elevationMeters = 3000): HitTarget {
	return { slug, name: slug.toUpperCase(), elevationMeters, x, y, label: undefined };
}

function setup(targets: HitTarget[] = []) {
	FakeHandler.live.clear();
	const canvas = new FakeCanvas();
	const markers: PickableMarkers & { targets: HitTarget[]; emphasized: (string | undefined)[] } = {
		targets,
		emphasized: [],
		emphasize(slug) {
			this.emphasized.push(slug);
		}
	};
	const picker = new AtlasPicker(FAKE_CESIUM, canvas as unknown as HTMLCanvasElement, markers);
	const handler = () => [...FakeHandler.live][0];

	return { canvas, markers, picker, handler };
}

describe('AtlasPicker input lifecycle', () => {
	it('listens to nothing until subscribed', () => {
		const { canvas } = setup();

		expect(FakeHandler.live.size).toBe(0);
		expect(canvas.liveListeners).toBe(0);
	});

	it('holds one Cesium handler and its own pointer listeners while subscribed', () => {
		const { canvas, picker, handler } = setup();

		const release = picker.subscribe(() => {});
		picker.subscribe(() => {});

		expect(FakeHandler.live.size).toBe(1);
		expect(handler()!.element).toBe(canvas);
		expect(canvas.liveListeners).toBe(3);

		release();
		expect(FakeHandler.live.size).toBe(1);
	});

	it('removes the handler and every listener when the last subscription ends', () => {
		const { canvas, picker } = setup();

		const release = picker.subscribe(() => {});
		release();

		expect(FakeHandler.live.size).toBe(0);
		expect(canvas.liveListeners).toBe(0);
	});

	it('leaves nothing behind on release, and takes no subscription after it', () => {
		const { canvas, picker } = setup();
		picker.subscribe(() => {});

		picker.release();
		picker.release();
		picker.subscribe(() => {});

		expect(FakeHandler.live.size).toBe(0);
		expect(canvas.liveListeners).toBe(0);
	});

	it('hands a click to the newest listener only', () => {
		const { picker, handler } = setup([target('peak', 100, 100)]);
		const first = vi.fn();
		const second = vi.fn();
		picker.subscribe(first);
		picker.subscribe(second);

		handler()!.click(100, 100);

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
	});
});

describe('AtlasPicker clicks', () => {
	function subscribed(targets: HitTarget[]) {
		const parts = setup(targets);
		const heard: MarkerActivation[] = [];
		parts.picker.subscribe((activation) => heard.push(activation));

		return { ...parts, heard };
	}

	it('opens the mountain under a click', () => {
		const { handler, heard } = subscribed([target('peak', 100, 100), target('far', 300, 100)]);

		handler()!.click(103, 98);

		expect(heard).toEqual([{ kind: 'mountain', mountain: { slug: 'peak', name: 'PEAK' } }]);
	});

	it('hears nothing from a click on bare globe', () => {
		const { handler, heard } = subscribed([target('peak', 100, 100)]);

		handler()!.click(200, 200);

		expect(heard).toEqual([]);
	});

	it('offers a choice, at the point clicked, when two dots merge', () => {
		const { handler, heard } = subscribed([
			target('fitz-roy', 100, 100, 3405),
			target('cerro-torre', 101, 101, 3133)
		]);

		handler()!.click(100, 101);

		expect(heard).toEqual([
			{
				kind: 'choice',
				mountains: [
					{ slug: 'fitz-roy', name: 'FITZ-ROY' },
					{ slug: 'cerro-torre', name: 'CERRO-TORRE' }
				],
				at: { x: 100, y: 101 }
			}
		]);
	});

	it('reaches farther after a touch than after a mouse press', () => {
		const reach = (MARKER_HIT.fine.radiusPixels + MARKER_HIT.coarse.radiusPixels) / 2;
		const { canvas, handler, heard } = subscribed([target('peak', 100, 100)]);

		canvas.pointer('pointerdown', { pointerType: 'mouse' });
		handler()!.click(100 + reach, 100);
		expect(heard).toEqual([]);

		canvas.pointer('pointerdown', { pointerType: 'touch' });
		handler()!.click(100 + reach, 100);
		expect(heard).toHaveLength(1);
	});

	it('treats a pen like a mouse', () => {
		const reach = MARKER_HIT.fine.radiusPixels + 2;
		const { canvas, handler, heard } = subscribed([target('peak', 100, 100)]);

		canvas.pointer('pointerdown', { pointerType: 'pen' });
		handler()!.click(100 + reach, 100);

		expect(heard).toEqual([]);
	});

	it('hits only the markers the layer lists at the moment of the click', () => {
		const { markers, handler, heard } = subscribed([target('peak', 100, 100)]);

		markers.targets = [];
		handler()!.click(100, 100);

		expect(heard).toEqual([]);
	});
});

describe('AtlasPicker hover', () => {
	it('points and emphasizes while the mouse rests on a marker, and stops off it', () => {
		const { canvas, markers, picker } = setup([target('peak', 100, 100)]);
		picker.subscribe(() => {});

		canvas.pointer('pointermove', { x: 104, y: 100 });
		expect(canvas.style.cursor).toBe('pointer');
		expect(markers.emphasized.at(-1)).toBe('peak');

		canvas.pointer('pointermove', { x: 200, y: 100 });
		expect(canvas.style.cursor).toBe('');
		expect(markers.emphasized.at(-1)).toBeUndefined();
	});

	it('points but emphasizes nothing over merged dots, which ask rather than open', () => {
		const { canvas, markers, picker } = setup([target('a', 100, 100), target('b', 101, 100)]);
		picker.subscribe(() => {});

		canvas.pointer('pointermove', { x: 100, y: 100 });

		expect(canvas.style.cursor).toBe('pointer');
		expect(markers.emphasized.at(-1)).toBeUndefined();
	});

	it('does no hover work during a drag or for a finger', () => {
		const { canvas, markers, picker } = setup([target('peak', 100, 100)]);
		picker.subscribe(() => {});

		canvas.pointer('pointermove', { x: 100, y: 100, buttons: 1 });
		canvas.pointer('pointermove', { x: 100, y: 100, pointerType: 'touch' });

		expect(markers.emphasized).toEqual([]);
		expect(canvas.style.cursor).toBe('');
	});

	it('ends the hover on a press, and on leaving the canvas', () => {
		const { canvas, markers, picker } = setup([target('peak', 100, 100)]);
		picker.subscribe(() => {});

		canvas.pointer('pointermove', { x: 100, y: 100 });
		canvas.pointer('pointerdown', { x: 100, y: 100 });
		expect(canvas.style.cursor).toBe('');
		expect(markers.emphasized.at(-1)).toBeUndefined();

		canvas.pointer('pointermove', { x: 100, y: 100 });
		canvas.pointer('pointerleave', {});
		expect(canvas.style.cursor).toBe('');
		expect(markers.emphasized.at(-1)).toBeUndefined();
	});

	it('follows a marker that moves away from a resting mouse as the globe turns', () => {
		const { canvas, markers, picker } = setup([target('peak', 100, 100)]);
		picker.subscribe(() => {});
		canvas.pointer('pointermove', { x: 100, y: 100 });

		markers.targets = [target('peak', 140, 100)];
		picker.refreshed();

		expect(canvas.style.cursor).toBe('');
		expect(markers.emphasized.at(-1)).toBeUndefined();
	});

	it('searches nothing on a camera change while no mouse rests on the canvas', () => {
		const { canvas, markers, picker } = setup([target('peak', 100, 100)]);
		picker.subscribe(() => {});
		const targets = vi.spyOn(markers, 'targets', 'get');

		picker.refreshed();

		expect(targets).not.toHaveBeenCalled();
		expect(canvas.style.cursor).toBe('');
	});

	it('leaves no cursor or emphasis behind when the subscription ends', () => {
		const { canvas, markers, picker } = setup([target('peak', 100, 100)]);
		const release = picker.subscribe(() => {});
		canvas.pointer('pointermove', { x: 100, y: 100 });

		release();

		expect(canvas.style.cursor).toBe('');
		expect(markers.emphasized.at(-1)).toBeUndefined();
	});
});
