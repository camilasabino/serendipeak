import type { ScaleReading } from './scaleBar';

const DEFAULT_MIN_INTERVAL_MS = 120;
const MIN_WIDTH_DELTA_PX = 1;

interface ScaleTrackerOptions {
	sample: () => ScaleReading | undefined;
	publish: (reading: ScaleReading | undefined) => void;
	listen: (onChange: () => void) => () => void;
	now?: () => number;
	schedule?: (work: () => void, delayMs: number) => () => void;
	minIntervalMs?: number;
}

function delay(work: () => void, delayMs: number): () => void {
	const id = setTimeout(work, delayMs);
	return () => clearTimeout(id);
}

function sameReading(a: ScaleReading | undefined, b: ScaleReading | undefined): boolean {
	if (a === undefined || b === undefined) {
		return a === b;
	}
	return a.label === b.label && Math.abs(a.widthPx - b.widthPx) < MIN_WIDTH_DELTA_PX;
}

export class ScaleTracker {
	private readonly sample: ScaleTrackerOptions['sample'];
	private readonly publish: ScaleTrackerOptions['publish'];
	private readonly now: () => number;
	private readonly schedule: (work: () => void, delayMs: number) => () => void;
	private readonly minIntervalMs: number;
	private readonly stopListening: () => void;
	private published: ScaleReading | undefined;
	private queued = false;
	private stopped = false;
	private lastFlush = Number.NEGATIVE_INFINITY;
	private cancelScheduled = () => {};

	constructor({
		sample,
		publish,
		listen,
		now = () => performance.now(),
		schedule = delay,
		minIntervalMs = DEFAULT_MIN_INTERVAL_MS
	}: ScaleTrackerOptions) {
		this.sample = sample;
		this.publish = publish;
		this.now = now;
		this.schedule = schedule;
		this.minIntervalMs = minIntervalMs;
		this.stopListening = listen(() => this.refresh());
		this.refresh();
	}

	refresh(): void {
		if (this.stopped || this.queued) {
			return;
		}
		this.queued = true;
		this.cancelScheduled = this.schedule(
			() => this.flush(),
			Math.max(0, this.minIntervalMs - (this.now() - this.lastFlush))
		);
	}

	release(): void {
		if (this.stopped) {
			return;
		}
		this.stopped = true;
		this.cancelScheduled();
		this.queued = false;
		this.stopListening();
		if (this.published !== undefined) {
			this.published = undefined;
			this.publish(undefined);
		}
	}

	private flush(): void {
		this.queued = false;
		if (this.stopped) {
			return;
		}
		this.lastFlush = this.now();
		const reading = this.sample();
		if (sameReading(this.published, reading)) {
			return;
		}
		this.published = reading;
		this.publish(reading);
	}
}
