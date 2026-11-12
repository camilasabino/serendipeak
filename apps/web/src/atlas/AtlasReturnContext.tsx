import { createContext, useContext } from 'react';
import type { AtlasReturn } from './AtlasReturn';

const AtlasReturnContext = createContext<AtlasReturn | undefined>(undefined);

export const AtlasReturnProvider = AtlasReturnContext.Provider;

/** Undefined outside the app, as in a static render, where a link simply navigates. */
export function useAtlasReturn(): AtlasReturn | undefined {
	return useContext(AtlasReturnContext);
}
