import type { SummitSightings } from '../stage/globe/summitSighting';

type Listener = (sightings: SummitSightings | undefined) => void;

/**
 * Hands the stage's latest sightings to whatever lays out the indicators. It outlives both sides:
 * a surface that mounts later hears the latest reading at once, and a scene rebuilt under it keeps
 * publishing into the same feed.
 */
export class SightingFeed {
	private latest: SummitSightings | undefined;
	private readonly listeners = new Set<Listener>();

	// An arrow property because the stage receives it detached, as a callback.
	readonly publish = (sightings: SummitSightings | undefined): void => {
		this.latest = sightings;
		for (const listener of [...this.listeners]) {
			listener(sightings);
		}
	};

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.latest);

		return () => {
			this.listeners.delete(listener);
		};
	}
}
