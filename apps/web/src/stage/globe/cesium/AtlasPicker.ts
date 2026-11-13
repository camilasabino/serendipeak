import type { ScreenSpaceEventHandler } from 'cesium';
import type { ScreenPoint } from '../atlasMarkers';
import {
	resolveMarkerHit,
	type HitTarget,
	type MarkerHit,
	type PointerPrecision
} from '../markerHits';
import type { MarkerActivation } from '../markerActivation';
import type { CesiumModule } from './CesiumModule';

/** The atlas layer as the picker sees it. */
export interface PickableMarkers {
	readonly targets: readonly HitTarget[];
	emphasize(slug: string | undefined): void;
}

const LISTENER_OPTIONS = { capture: true, passive: true } as const;

/**
 * Turns presses on the canvas into marker activations, by screen-space hit testing against the
 * markers the last visibility pass drew. No GPU pick runs on any path.
 *
 * Cesium's own click event decides what is a click: it fires for a mouse click and a finger tap
 * alike and never after a drag of 5 px or more, so pans, pinches and wheel zooms stay Cesium's.
 * The pointer that pressed decides the hit radius. Hover only ever follows a mouse with no button
 * down, and reuses the positions the visibility pass already projected.
 */
export class AtlasPicker {
	private handler: ScreenSpaceEventHandler | undefined;
	private listener: ((activation: MarkerActivation) => void) | undefined;
	private precision: PointerPrecision = 'fine';
	private mouse: ScreenPoint | undefined;
	private cursor = false;
	private released = false;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly canvas: HTMLCanvasElement,
		private readonly markers: PickableMarkers
	) {}

	/** A new subscription replaces the previous one; ending the last one removes every handler. */
	subscribe(listener: (activation: MarkerActivation) => void): () => void {
		if (this.released) {
			return () => {};
		}
		this.listener = listener;
		this.attach();

		return () => {
			if (this.listener === listener) {
				this.listener = undefined;
				this.detach();
			}
		};
	}

	/** The markers moved on screen or went away: the mouse may rest on a different one now. */
	refreshed(): void {
		if (this.mouse) {
			this.hover(this.mouse);
		} else {
			this.clearHover();
		}
	}

	/** Idempotent. */
	release(): void {
		if (this.released) {
			return;
		}
		this.released = true;
		this.listener = undefined;
		this.detach();
	}

	private attach(): void {
		if (this.handler) {
			return;
		}
		const { ScreenSpaceEventHandler, ScreenSpaceEventType } = this.cesium;
		const handler = new ScreenSpaceEventHandler(this.canvas);
		handler.setInputAction(
			({ position }: ScreenSpaceEventHandler.PositionedEvent) => this.click(position),
			ScreenSpaceEventType.LEFT_CLICK
		);
		this.handler = handler;
		this.canvas.addEventListener('pointerdown', this.onPointerDown, LISTENER_OPTIONS);
		this.canvas.addEventListener('pointermove', this.onPointerMove, LISTENER_OPTIONS);
		this.canvas.addEventListener('pointerleave', this.onPointerLeave, LISTENER_OPTIONS);
	}

	private detach(): void {
		const handler = this.handler;
		this.handler = undefined;
		this.canvas.removeEventListener('pointerdown', this.onPointerDown, LISTENER_OPTIONS);
		this.canvas.removeEventListener('pointermove', this.onPointerMove, LISTENER_OPTIONS);
		this.canvas.removeEventListener('pointerleave', this.onPointerLeave, LISTENER_OPTIONS);
		this.mouse = undefined;
		this.clearHover();
		if (handler && !handler.isDestroyed()) {
			handler.destroy();
		}
	}

	private click(position: ScreenPoint): void {
		const listener = this.listener;
		if (!listener) {
			return;
		}
		const hit = resolveMarkerHit(this.markers.targets, position, this.precision);
		const activation = activationOf(hit, position);
		if (activation) {
			listener(activation);
		}
	}

	// A press starts what may become a drag, so the hover ends until the mouse moves freely again.
	private readonly onPointerDown = (event: PointerEvent): void => {
		this.precision = event.pointerType === 'touch' ? 'coarse' : 'fine';
		this.mouse = undefined;
		this.clearHover();
	};

	private readonly onPointerMove = (event: PointerEvent): void => {
		if (event.pointerType !== 'mouse' || event.buttons !== 0) {
			return;
		}
		const rect = this.canvas.getBoundingClientRect();
		this.mouse = { x: event.clientX - rect.left, y: event.clientY - rect.top };
		this.hover(this.mouse);
	};

	private readonly onPointerLeave = (): void => {
		this.mouse = undefined;
		this.clearHover();
	};

	private hover(pointer: ScreenPoint): void {
		const hit = resolveMarkerHit(this.markers.targets, pointer, 'fine');
		this.markers.emphasize(hit.kind === 'mountain' ? hit.mountain.slug : undefined);
		this.setCursor(hit.kind !== 'none');
	}

	private clearHover(): void {
		this.markers.emphasize(undefined);
		this.setCursor(false);
	}

	private setCursor(pointing: boolean): void {
		if (pointing === this.cursor) {
			return;
		}
		this.cursor = pointing;
		this.canvas.style.cursor = pointing ? 'pointer' : '';
	}
}

function activationOf(hit: MarkerHit, at: ScreenPoint): MarkerActivation | undefined {
	switch (hit.kind) {
		case 'mountain':
			return { kind: 'mountain', mountain: hit.mountain };
		case 'choice':
			return { kind: 'choice', mountains: hit.mountains, at: { x: at.x, y: at.y } };
		default:
			return undefined;
	}
}
