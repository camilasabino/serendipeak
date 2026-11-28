import {
	activeFilterCount,
	NO_FILTERS,
	WHOLE_ATLAS,
	type AtlasFilters,
	type AtlasScope
} from './atlasFilter';
import { DEFAULT_ATLAS_SORT, type AtlasSort } from './atlasSort';
import { sameSelection } from './elevationBands';

/** How the reader has narrowed and ordered the atlas. Immutable: every change is a new object. */
export interface AtlasView {
	filters: AtlasFilters;
	sort: AtlasSort;
	/**
	 * The continent the reader has gone into, and whether they are on its mountain ranges rather
	 * than its mountains. While a range is browsed it is where they came from, so the trail can
	 * climb back; the range itself is always `filters.range`. It ends when the range filter is left.
	 */
	continent: ContinentBrowse | null;
}

export interface ContinentBrowse {
	code: string;
	ranges: boolean;
}

export const DEFAULT_ATLAS_VIEW: AtlasView = {
	filters: NO_FILTERS,
	sort: DEFAULT_ATLAS_SORT,
	continent: null
};

/** The default view shows the catalog by continent; any other shows one sorted list of matches. */
export function isDefaultView({ filters, sort }: AtlasView): boolean {
	return activeFilterCount(filters) === 0 && sort === DEFAULT_ATLAS_SORT;
}

/**
 * Where the reader has navigated to, which bounds what the filters offer: the range being browsed,
 * else the continent they are in, else the whole atlas.
 */
export function scopeOf({
	filters,
	continent
}: Pick<AtlasView, 'filters' | 'continent'>): AtlasScope {
	if (filters.range !== null) {
		return { kind: 'range', slug: filters.range };
	}

	return continent === null ? WHOLE_ATLAS : { kind: 'continent', code: continent.code };
}

/** The view with these filters; leaving the range filter ends the continent browse with it. */
export function withFilters(view: AtlasView, filters: AtlasFilters): AtlasView {
	const leavesRange = view.filters.range !== null && filters.range === null;

	return { ...view, filters, continent: leavesRange ? null : view.continent };
}

function sameFilters(a: AtlasFilters, b: AtlasFilters): boolean {
	return (
		a.country === b.country &&
		sameSelection(a.elevationBands, b.elevationBands) &&
		a.range === b.range
	);
}

/**
 * The atlas view of one reader, held by the stage layout so it outlives the atlas panel: a reader
 * who opens a mountain and returns finds the list and the globe as they left them. Kept in memory
 * only, and never in the URL. The displayed unit system is not part of it, but elevation bands are
 * native to one, so `clearElevationForUnits` drops them when the reader switches units.
 */
export class AtlasViewStore {
	private snapshot: AtlasView = DEFAULT_ATLAS_VIEW;
	private readonly listeners = new Set<() => void>();
	private readonly clearedListeners = new Set<() => void>();

	// Arrow properties because React receives them detached (useSyncExternalStore).
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	readonly getSnapshot = (): AtlasView => this.snapshot;

	/** Called after a unit change cleared the elevation bands, for whoever announces it. */
	readonly subscribeToUnitClears = (listener: () => void): (() => void) => {
		this.clearedListeners.add(listener);
		return () => {
			this.clearedListeners.delete(listener);
		};
	};

	/** Country, range and sort stay; does nothing, and tells no one, when no band is selected. */
	clearElevationForUnits(): void {
		if (this.snapshot.filters.elevationBands === null) {
			return;
		}

		this.setFilters({ elevationBands: null });
		for (const listener of [...this.clearedListeners]) {
			listener();
		}
	}

	setFilters(change: Partial<AtlasFilters>): void {
		const filters = { ...this.snapshot.filters, ...change };
		if (!sameFilters(filters, this.snapshot.filters)) {
			this.publish(withFilters(this.snapshot, filters));
		}
	}

	/**
	 * Goes into a continent, to its mountains or to its ranges, leaving any range being browsed;
	 * `null` goes back to all continents. The other filters stay as given, by default as they are:
	 * whoever knows the catalog passes them already settled for where the reader is going.
	 */
	browseContinent(
		next: ContinentBrowse | null,
		filters: AtlasFilters = this.snapshot.filters
	): void {
		const { continent } = this.snapshot;
		const left = filters.range === null ? filters : { ...filters, range: null };
		const same = next?.code === continent?.code && next?.ranges === continent?.ranges;
		if (same && sameFilters(left, this.snapshot.filters)) {
			return;
		}

		this.publish({ ...this.snapshot, filters: left, continent: next });
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
