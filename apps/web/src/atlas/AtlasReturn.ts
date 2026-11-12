import { ATLAS_PATH } from './atlasQuery';

type RouteEventName = 'routeChangeStart' | 'routeChangeComplete' | 'routeChangeError';

/** The slice of the Next router that the tracker listens to. */
export interface AtlasReturnRouter {
	readonly pathname: string;
	readonly events: {
		on(event: RouteEventName, handler: (url: string) => void): void;
		off(event: RouteEventName, handler: (url: string) => void): void;
	};
	beforePopState(callback: () => boolean): void;
}

// Next stamps every history entry it creates with a key that survives Back and Forward and that
// no other entry shares. Anything else it does not recognise leaves the answer "unknown".
function historyEntryKey(): string | undefined {
	const state: unknown = window.history.state;
	if (typeof state !== 'object' || state === null || !('key' in state)) {
		return undefined;
	}

	return typeof state.key === 'string' ? state.key : undefined;
}

function pathOf(url: string): string {
	return url.split(/[?#]/, 1)[0] ?? url;
}

/**
 * Remembers which history entries a reader opened from the atlas, so "Back to atlas" can step back
 * to it instead of stacking a second atlas entry above the mountain they came from.
 *
 * Only a push from the atlas counts. A Back, a Forward or a replace never creates an entry above
 * the atlas, so they are never recorded. Whatever is unknown, after a reload or when Next stops
 * stamping its entries, answers "no" and the link navigates normally: the cost of an unknown is
 * one extra history entry, never a trip to the wrong page.
 */
export class AtlasReturn {
	private readonly openedFromAtlas = new Set<string>();
	private leaving: { entryKey: string | undefined } | undefined;
	private popped = false;

	constructor(private readonly currentEntryKey: () => string | undefined = historyEntryKey) {}

	/** Whether the entry the reader is on was opened from the atlas, which then sits right below it. */
	get entryBelowIsAtlas(): boolean {
		const key = this.currentEntryKey();

		return key !== undefined && this.openedFromAtlas.has(key);
	}

	/** Starts listening; the returned function stops it. */
	bind(router: AtlasReturnRouter): () => void {
		const started = (url: string) => {
			this.leaving =
				router.pathname === ATLAS_PATH && pathOf(url) !== ATLAS_PATH
					? { entryKey: this.currentEntryKey() }
					: undefined;
		};
		const completed = () => {
			const { leaving, popped } = this;
			this.leaving = undefined;
			this.popped = false;

			const key = this.currentEntryKey();
			// A new key is a new entry; a replace keeps the key it had.
			if (leaving && !popped && key !== undefined && key !== leaving.entryKey) {
				this.openedFromAtlas.add(key);
			}
		};
		const failed = () => {
			this.leaving = undefined;
			this.popped = false;
		};

		router.beforePopState(() => {
			this.popped = true;
			return true;
		});
		router.events.on('routeChangeStart', started);
		router.events.on('routeChangeComplete', completed);
		router.events.on('routeChangeError', failed);

		return () => {
			router.events.off('routeChangeStart', started);
			router.events.off('routeChangeComplete', completed);
			router.events.off('routeChangeError', failed);
			router.beforePopState(() => true);
			this.leaving = undefined;
			this.popped = false;
		};
	}
}

/** A plain primary-button click: the browser's own handling stands for anything else. */
export function isPlainClick(event: {
	button: number;
	metaKey: boolean;
	ctrlKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
	defaultPrevented: boolean;
}): boolean {
	return (
		event.button === 0 &&
		!event.defaultPrevented &&
		!event.metaKey &&
		!event.ctrlKey &&
		!event.shiftKey &&
		!event.altKey
	);
}
