import { createContext, useContext, useState } from 'react';

const OpenContinentsContext = createContext<Set<string> | undefined>(undefined);

/**
 * The continents a reader opened in the atlas list. The stage layout holds them, so a reader who
 * opens a mountain and comes back finds the list as they left it; a fresh visit starts collapsed.
 */
export const OpenContinentsProvider = OpenContinentsContext.Provider;

export function useOpenContinents(): Set<string> {
	const shared = useContext(OpenContinentsContext);
	const [own] = useState(() => new Set<string>());

	return shared ?? own;
}
