import { createContext, useContext } from 'react';
import type { MountainIndexStore } from './MountainIndexStore';

const MountainIndexContext = createContext<MountainIndexStore | undefined>(undefined);

export const MountainIndexProvider = MountainIndexContext.Provider;

export function useMountainIndex(): MountainIndexStore {
	const store = useContext(MountainIndexContext);
	if (!store) {
		throw new Error('MountainIndexProvider is missing above this component.');
	}

	return store;
}
