import { DEFAULT_UNIT_SYSTEM, isUnitSystem, type UnitSystem } from './unitSystem';

export const UNIT_PREFERENCE_STORAGE_KEY = 'serendipeak:unit-system';

type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>;

/**
 * The visitor's chosen unit system, shared by the whole app. It starts from what storage holds and
 * falls back to metric, so a blocked or empty storage never breaks it. Snapshots are read on the
 * client only: server markup and the hydration render use the default through
 * `useSyncExternalStore`'s server snapshot.
 */
export class UnitPreferenceStore {
	private readonly listeners = new Set<() => void>();
	private current: UnitSystem;

	constructor(private readonly storage?: PreferenceStorage) {
		this.current = this.read();
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);

		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): UnitSystem => this.current;

	getServerSnapshot = (): UnitSystem => DEFAULT_UNIT_SYSTEM;

	set(system: UnitSystem): void {
		if (system === this.current) {
			return;
		}

		this.current = system;
		this.write(system);
		this.listeners.forEach((listener) => listener());
	}

	private read(): UnitSystem {
		try {
			const stored = this.storage?.getItem(UNIT_PREFERENCE_STORAGE_KEY);

			return isUnitSystem(stored) ? stored : DEFAULT_UNIT_SYSTEM;
		} catch {
			return DEFAULT_UNIT_SYSTEM;
		}
	}

	private write(system: UnitSystem): void {
		try {
			this.storage?.setItem(UNIT_PREFERENCE_STORAGE_KEY, system);
		} catch {
			// Private windows and blocked site data throw; the choice then lasts for the session.
		}
	}
}

/** `window.localStorage`, or nothing where reading the property itself throws. */
export function browserPreferenceStorage(): PreferenceStorage | undefined {
	try {
		return typeof window === 'undefined' ? undefined : window.localStorage;
	} catch {
		return undefined;
	}
}
