import { createContext, useCallback, useContext, useSyncExternalStore } from 'react';
import type { AtlasReturn } from './AtlasReturn';

const AtlasReturnContext = createContext<AtlasReturn | undefined>(undefined);

export const AtlasReturnProvider = AtlasReturnContext.Provider;

/** Undefined outside the app, as in a static render, where a link simply navigates. */
export function useAtlasReturn(): AtlasReturn | undefined {
	return useContext(AtlasReturnContext);
}

const noSubscription = () => () => {};
const never = () => false;

/**
 * Whether the page on screen was opened from the atlas. The server and the hydration render
 * answer no, since a document request carries no atlas visit, so markup and first client render
 * agree; a later navigation or Back and Forward answers from the entries the app has seen.
 */
export function useOpenedFromAtlas(): boolean {
	const atlasReturn = useAtlasReturn();
	const subscribe = useCallback(
		(listener: () => void) => atlasReturn?.subscribe(listener) ?? noSubscription(),
		[atlasReturn]
	);
	const snapshot = useCallback(() => atlasReturn?.entryBelowIsAtlas ?? false, [atlasReturn]);

	return useSyncExternalStore(subscribe, snapshot, never);
}
