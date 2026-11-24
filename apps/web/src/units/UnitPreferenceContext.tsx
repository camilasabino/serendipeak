import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from './unitSystem';

/** What the components need of the preference, so tests can serve a fixed system. */
export interface UnitPreference {
	subscribe: (listener: () => void) => () => void;
	getSnapshot: () => UnitSystem;
	getServerSnapshot: () => UnitSystem;
	set: (system: UnitSystem) => void;
}

const UnitPreferenceContext = createContext<UnitPreference | undefined>(undefined);

export const UnitPreferenceProvider = UnitPreferenceContext.Provider;

const subscribeNothing = () => () => {};
const metric = () => DEFAULT_UNIT_SYSTEM;

/** The unit system to display, metric where no provider is above (isolated renders). */
export function useUnitSystem(): UnitSystem {
	const store = useContext(UnitPreferenceContext);

	return useSyncExternalStore(
		store?.subscribe ?? subscribeNothing,
		store?.getSnapshot ?? metric,
		store?.getServerSnapshot ?? metric
	);
}

export function useSetUnitSystem(): (system: UnitSystem) => void {
	const store = useContext(UnitPreferenceContext);

	return useCallback((system: UnitSystem) => store?.set(system), [store]);
}
