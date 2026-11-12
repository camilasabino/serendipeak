import { displayHeadingDegrees, type ViewOrientation } from './globe/orientation';
import type { ScaleReading } from './globe/scaleBar';
import type { SceneState } from './sceneState';

export interface SceneSnapshot {
	readonly state: SceneState;
	readonly headingDegrees: number | undefined;
	readonly scale: ScaleReading | undefined;
	/** The presented mountain arrived; the camera shows the pose that was chosen for it. */
	readonly settled: boolean;
	/** No mountain is presented and no flight runs: the camera belongs to free navigation. */
	readonly free: boolean;
	/**
	 * The ambient turn of the atlas overview: `off` where it cannot run (no overview, or reduced
	 * motion), otherwise whether it turns or waits to be resumed.
	 */
	readonly rotation: RotationState;
}

export type RotationState = 'off' | 'rotating' | 'paused';

function sameState(a: SceneState, b: SceneState): boolean {
	if (a.status !== b.status) {
		return false;
	}
	if (a.status === 'ready' && b.status === 'ready') {
		return a.imageryDegraded === b.imageryDegraded;
	}
	if (a.status === 'failed' && b.status === 'failed') {
		return a.failure === b.failure && a.message === b.message;
	}
	return true;
}

function sameScale(a: ScaleReading | undefined, b: ScaleReading | undefined): boolean {
	if (a === undefined || b === undefined) {
		return a === b;
	}
	return a.label === b.label && Math.round(a.widthPx) === Math.round(b.widthPx);
}

export class SceneStore {
	private snapshot: SceneSnapshot = {
		state: { status: 'loading' },
		headingDegrees: undefined,
		scale: undefined,
		settled: false,
		free: false,
		rotation: 'off'
	};
	private readonly listeners = new Set<() => void>();

	// Arrow properties because React receives them detached (useSyncExternalStore).
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	readonly getSnapshot = (): SceneSnapshot => this.snapshot;

	setState(state: SceneState): void {
		if (sameState(this.snapshot.state, state)) {
			return;
		}
		this.replace({ state });
	}

	setOrientation(orientation: ViewOrientation | undefined): void {
		const rounded = orientation
			? displayHeadingDegrees(orientation.viewHeadingDegrees)
			: Number.NaN;
		const headingDegrees = Number.isFinite(rounded) ? rounded : undefined;
		if (headingDegrees === this.snapshot.headingDegrees) {
			return;
		}
		this.replace({ headingDegrees });
	}

	setScale(scale: ScaleReading | undefined): void {
		if (sameScale(this.snapshot.scale, scale)) {
			return;
		}
		this.replace({ scale });
	}

	setSettled(settled: boolean): void {
		if (settled === this.snapshot.settled) {
			return;
		}
		this.replace({ settled });
	}

	setFree(free: boolean): void {
		if (free === this.snapshot.free) {
			return;
		}
		this.replace({ free });
	}

	setRotation(rotation: RotationState): void {
		if (rotation === this.snapshot.rotation) {
			return;
		}
		this.replace({ rotation });
	}

	private replace(change: Partial<SceneSnapshot>): void {
		this.snapshot = { ...this.snapshot, ...change };
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}
