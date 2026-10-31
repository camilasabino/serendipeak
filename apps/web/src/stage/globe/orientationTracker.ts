import { type ViewOrientation, normalizeDegrees } from './orientation';

const DEFAULT_MIN_DELTA_DEGREES = 0.2;

interface OrientationTrackerOptions {
	sample: () => ViewOrientation | undefined;
	publish: (orientation: ViewOrientation | undefined) => void;
	listen: (onFrame: () => void) => () => void;
	schedule?: (work: () => void) => () => void;
	minDeltaDegrees?: number;
}

function angularSeparation(a: number, b: number): number {
	const delta = Math.abs(normalizeDegrees(a) - normalizeDegrees(b));
	return delta > 180 ? 360 - delta : delta;
}

function requestFrame(work: () => void): () => void {
	const id = requestAnimationFrame(work);
	return () => cancelAnimationFrame(id);
}

export class OrientationTracker {
	private readonly sample: OrientationTrackerOptions['sample'];
	private readonly publish: OrientationTrackerOptions['publish'];
	private readonly schedule: (work: () => void) => () => void;
	private readonly minDeltaDegrees: number;
	private readonly stopListening: () => void;
	private published: number | undefined;
	private announced = false;
	private pending: ViewOrientation | undefined;
	private queued = false;
	private cancelScheduled = () => {};
	private stopped = false;

	constructor({
		sample,
		publish,
		listen,
		schedule = requestFrame,
		minDeltaDegrees = DEFAULT_MIN_DELTA_DEGREES
	}: OrientationTrackerOptions) {
		this.sample = sample;
		this.publish = publish;
		this.schedule = schedule;
		this.minDeltaDegrees = minDeltaDegrees;
		this.stopListening = listen(() => this.flush());
		this.flush();
	}

	release(): void {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.cancelScheduled();
		this.queued = false;
		this.stopListening();
		this.published = undefined;
		this.publish(undefined);
	}

	private queue(orientation: ViewOrientation | undefined): void {
		this.pending = orientation;
		if (this.queued) {
			return;
		}
		this.queued = true;
		this.cancelScheduled = this.schedule(() => {
			this.queued = false;
			if (this.stopped) {
				return;
			}
			this.publish(this.pending);
		});
	}

	private flush(): void {
		if (this.stopped) {
			return;
		}
		const heading = this.sample()?.viewHeadingDegrees;
		if (heading === undefined || !Number.isFinite(heading)) {
			if (!this.announced || this.published !== undefined) {
				this.published = undefined;
				this.announced = true;
				this.queue(undefined);
			}
			return;
		}
		if (
			this.published !== undefined &&
			angularSeparation(this.published, heading) < this.minDeltaDegrees
		) {
			return;
		}
		this.published = heading;
		this.announced = true;
		this.queue({ viewHeadingDegrees: heading });
	}
}

export type { ViewOrientation };
