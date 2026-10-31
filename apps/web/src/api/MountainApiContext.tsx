import { createContext, useContext } from 'react';
import type { MountainApi } from './MountainApi';

const MountainApiContext = createContext<MountainApi | undefined>(undefined);

export const MountainApiProvider = MountainApiContext.Provider;

export function useMountainApi(): MountainApi {
	const api = useContext(MountainApiContext);
	if (!api) {
		throw new Error('MountainApiProvider is missing above this component.');
	}

	return api;
}
