import { activeFilterCount, NO_FILTERS, sameBands, type AtlasFilters } from './atlasFilter';
import { DEFAULT_ATLAS_SORT, type AtlasSort } from './atlasSort';

/** How the reader has narrowed and ordered the atlas. Immutable: every change is a new object. */
export interface AtlasView {
	filters: AtlasFilters;
	sort: AtlasSort;
}

export const DEFAULT_ATLAS_VIEW: AtlasView = { filters: NO_FILTERS, sort: DEFAULT_ATLAS_SORT };

/** The default view shows the catalog by continent; any other shows one sorted list of matches. */
export function isDefaultView({ filters, sort }: AtlasView): boolean {
	return activeFilterCount(filters) === 0 && sort === DEFAULT_ATLAS_SORT;
}

/**
 * The atlas view of one reader, held by the stage layout so it outlives the atlas panel: a reader
 * who opens a mountain and returns finds the list and the globe as they left them. Kept in memory
 * only, and never in the URL.
 */
export class AtlasViewStore {
	private snapshot: AtlasView = DEFAULT_ATLAS_VIEW;
	private readonly listeners = new Set<() => void>();

	// Arrow properties because React receives them detached (useSyncExternalStore).
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	readonly getSnapshot = (): AtlasView => this.snapshot;

	setFilters(change: Partial<AtlasFilters>): void {
		const filters = { ...this.snapshot.filters, ...change };
		const unchanged =
			filters.country === this.snapshot.filters.country &&
			sameBands(filters.elevationBands, this.snapshot.filters.elevationBands) &&
			filters.range === this.snapshot.filters.range;
		if (!unchanged) {
			this.publish({ ...this.snapshot, filters });
		}
	}

	setSort(sort: AtlasSort): void {
		if (sort !== this.snapshot.sort) {
			this.publish({ ...this.snapshot, sort });
		}
	}

	reset(): void {
		if (this.snapshot !== DEFAULT_ATLAS_VIEW) {
			this.publish(DEFAULT_ATLAS_VIEW);
		}
	}

	private publish(next: AtlasView): void {
		this.snapshot = next;
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}
