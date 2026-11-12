import type { MountainIndexResult } from '../api/contract';
import type { MountainApi } from '../api/MountainApi';
import { prepareIndex, type SearchableIndex } from './findMountains';

export type IndexFailure = 'unreachable' | 'api-error';

export type MountainIndexState =
	| { status: 'idle' }
	| { status: 'loading' }
	| { status: 'ready'; index: SearchableIndex }
	| { status: 'failed'; reason: IndexFailure };

/** Matches the API's own cache lifetime for the index. */
export const INDEX_MAX_AGE_MS = 5 * 60_000;

export interface MountainIndexStoreOptions {
	api: Pick<MountainApi, 'getMountainIndex'>;
	now?: () => number;
	maxAgeMs?: number;
	onError?: (error: unknown) => void;
}

const IDLE: MountainIndexState = { status: 'idle' };
const LOADING: MountainIndexState = { status: 'loading' };

function reportUnexpectedError(error: unknown): void {
	console.error('The mountain index could not be loaded', error);
}

// Loads the index on demand, never on page load, and keeps it for the life of the app.
export class MountainIndexStore {
	private snapshot: MountainIndexState = IDLE;
	private loadedAt = 0;
	private pending: Promise<void> | undefined;
	private readonly listeners = new Set<() => void>();
	private readonly now: () => number;
	private readonly maxAgeMs: number;
	private readonly onError: (error: unknown) => void;

	constructor(private readonly options: MountainIndexStoreOptions) {
		this.now = options.now ?? Date.now;
		this.maxAgeMs = options.maxAgeMs ?? INDEX_MAX_AGE_MS;
		this.onError = options.onError ?? reportUnexpectedError;
	}

	// Arrow properties because React receives them detached (useSyncExternalStore).
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	readonly getSnapshot = (): MountainIndexState => this.snapshot;

	/**
	 * Loads an index that is missing or failed, and refreshes one older than the maximum age in the
	 * background, keeping it searchable meanwhile. At most one request is in flight, so answers can
	 * never arrive out of order.
	 */
	request(): Promise<void> {
		if (this.pending) {
			return this.pending;
		}
		if (this.snapshot.status === 'ready' && this.now() - this.loadedAt < this.maxAgeMs) {
			return Promise.resolve();
		}

		this.pending = this.load().finally(() => {
			this.pending = undefined;
		});

		return this.pending;
	}

	private async load(): Promise<void> {
		const refreshing = this.snapshot.status === 'ready';
		if (!refreshing) {
			this.publish(LOADING);
		}

		const result = await this.fetchIndex();
		if (result.kind === 'found') {
			this.loadedAt = this.now();
			this.publish({ status: 'ready', index: prepareIndex(result.mountains) });
			return;
		}
		// A failed refresh keeps the index already shown; the next request tries again.
		if (!refreshing) {
			this.publish({
				status: 'failed',
				reason: result.kind === 'unreachable' ? 'unreachable' : 'api-error'
			});
		}
	}

	private async fetchIndex(): Promise<MountainIndexResult> {
		try {
			return await this.options.api.getMountainIndex();
		} catch (error) {
			this.onError(error);
			return { kind: 'api-error', status: 0 };
		}
	}

	private publish(state: MountainIndexState): void {
		this.snapshot = state;
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}
