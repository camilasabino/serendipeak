import type { NearbySighting, SummitSighting, SummitSightings } from './summitSighting';

/** Projected positions closer than this are the same position on screen. */
const POSITION_EPSILON_PX = 0.5;
/** Directions closer than this, about 0.06°, point the same way. */
const DIRECTION_EPSILON = 1e-3;

interface SightingTrackerOptions {
	sample: () => SummitSightings | undefined;
	publish: (sightings: SummitSightings | undefined) => void;
	/** Calls back whenever the view may have changed: the camera, the stage size or the terrain. */
	listen: (onChange: () => void) => () => void;
	schedule?: (work: () => void) => () => void;
}

function requestFrame(work: () => void): () => void {
	const id = requestAnimationFrame(work);
	return () => cancelAnimationFrame(id);
}

function sameSighting(a: SummitSighting, b: SummitSighting): boolean {
	if (a.kind === 'ahead' && b.kind === 'ahead') {
		return Math.abs(a.x - b.x) < POSITION_EPSILON_PX && Math.abs(a.y - b.y) < POSITION_EPSILON_PX;
	}
	if (a.kind === 'behind' && b.kind === 'behind') {
		return Math.abs(a.dx - b.dx) < DIRECTION_EPSILON && Math.abs(a.dy - b.dy) < DIRECTION_EPSILON;
	}
	return a.kind === b.kind;
}

function sameBearing(a: SummitSighting | undefined, b: SummitSighting | undefined): boolean {
	return a === undefined || b === undefined ? a === b : sameSighting(a, b);
}

function sameNearby(a: readonly NearbySighting[], b: readonly NearbySighting[]): boolean {
	return (
		a.length === b.length &&
		a.every(
			(entry, index) =>
				entry.slug === b[index]!.slug &&
				entry.concealed === b[index]!.concealed &&
				sameSighting(entry.sighting, b[index]!.sighting) &&
				sameBearing(entry.bearing, b[index]!.bearing)
		)
	);
}

export function sameSightings(
	a: SummitSightings | undefined,
	b: SummitSightings | undefined
): boolean {
	if (a === undefined || b === undefined) {
		return a === b;
	}

	return (
		a.viewport.width === b.viewport.width &&
		a.viewport.height === b.viewport.height &&
		sameSighting(a.presented, b.presented) &&
		sameNearby(a.nearby, b.nearby)
	);
}

/**
 * Follows summits relative to the camera. It samples only when told the view may have changed,
 * publishes a reading only when it differs from the last one published, and at most once per
 * animation frame, so a flight or a drag costs one projection per summit per frame and the
 * listener hears the latest reading only. Releasing it stops listening and, if anything was
 * published, publishes `undefined` so nothing keeps showing a stale reading.
 */
export class SightingTracker {
	private readonly sample: SightingTrackerOptions['sample'];
	private readonly publish: SightingTrackerOptions['publish'];
	private readonly schedule: (work: () => void) => () => void;
	private readonly stopListening: () => void;
	private published: SummitSightings | undefined;
	private pending: SummitSightings | undefined;
	private announced = false;
	private queued = false;
	private cancelScheduled = () => {};
	private stopped = false;

	constructor({ sample, publish, listen, schedule = requestFrame }: SightingTrackerOptions) {
		this.sample = sample;
		this.publish = publish;
		this.schedule = schedule;
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
		if (this.announced) {
			this.publish(undefined);
		}
	}

	private flush(): void {
		if (this.stopped) {
			return;
		}
		const reading = this.sample();
		if (this.announced && sameSightings(this.published, reading)) {
			return;
		}
		this.published = reading;
		this.announced = true;
		this.pending = reading;
		if (this.queued) {
			return;
		}
		this.queued = true;
		this.cancelScheduled = this.schedule(() => {
			this.queued = false;
			if (!this.stopped) {
				this.publish(this.pending);
			}
		});
	}
}
