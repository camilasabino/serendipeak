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
 * Remembers which history entries a reader opened from the atlas, so a mountain page can offer
 * "Back to atlas" only to a reader who came from there, and so that link can step back to the
 * atlas instead of stacking a second atlas entry above the mountain.
 *
 * Only a push from the atlas counts, and only one made by an atlas control: its list, a marker or
 * the chooser. A search made while the atlas is open pushes from the atlas too, but the reader did
 * not pick that mountain from the atlas, so it declares itself through `navigateApart`. A Back, a
 * Forward or a replace never creates an entry above the atlas, so they are never recorded. Whatever is unknown, after a reload, in a new tab or when
 * Next stops stamping its entries, answers "no": the link is not offered, and one that is reached
 * anyway navigates normally, at the cost of one extra history entry, never a trip to the wrong
 * page.
 */
export class AtlasReturn {
	private readonly openedFromAtlas = new Set<string>();
	private readonly listeners = new Set<() => void>();
	private leaving: { entryKey: string | undefined } | undefined;
	// The push from the atlas is under way: its entry is stamped and rendered before Next announces
	// completion, so the page it shows must already be answered as opened from the atlas.
	private opening = false;
	private apart = false;
	private popped = false;

	constructor(private readonly currentEntryKey: () => string | undefined = historyEntryKey) {}

	/** Whether the entry the reader is on was opened from the atlas, which then sits right below it. */
	get entryBelowIsAtlas(): boolean {
		if (this.opening) {
			return true;
		}
		const key = this.currentEntryKey();

		return key !== undefined && this.openedFromAtlas.has(key);
	}

	/**
	 * Runs a navigation that does not come from an atlas control, though the atlas may be on screen.
	 * The declaration covers the next route change only and ends when the navigation settles, so a
	 * navigation that never starts cannot taint a later one from the atlas.
	 */
	async navigateApart<T>(navigation: () => Promise<T>): Promise<T> {
		this.apart = true;
		try {
			return await navigation();
		} finally {
			this.apart = false;
		}
	}

	/** Calls the listener whenever the answer may have changed; the returned function stops it. */
	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	}

	private changed(): void {
		for (const listener of [...this.listeners]) {
			listener();
		}
	}

	/** Starts listening; the returned function stops it. */
	bind(router: AtlasReturnRouter): () => void {
		const started = (url: string) => {
			const apart = this.apart;
			this.apart = false;
			this.leaving =
				router.pathname === ATLAS_PATH && pathOf(url) !== ATLAS_PATH && !apart
					? { entryKey: this.currentEntryKey() }
					: undefined;
			// Without a key on the atlas entry the push could never be recorded, so it is not announced.
			this.opening =
				!this.popped && this.leaving !== undefined && this.leaving.entryKey !== undefined;
			this.changed();
		};
		const completed = () => {
			const { leaving, popped } = this;
			this.leaving = undefined;
			this.opening = false;
			this.popped = false;

			const key = this.currentEntryKey();
			// A new key is a new entry; a replace keeps the key it had.
			if (leaving && !popped && key !== undefined && key !== leaving.entryKey) {
				this.openedFromAtlas.add(key);
			}
			this.changed();
		};
		const failed = () => {
			this.leaving = undefined;
			this.opening = false;
			this.popped = false;
			this.changed();
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
			this.opening = false;
			this.apart = false;
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
