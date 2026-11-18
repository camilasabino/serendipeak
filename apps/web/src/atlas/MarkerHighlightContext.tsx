import { createContext, useContext } from 'react';

/**
 * How the atlas list asks the globe to emphasize the marker of a mountain it points at. The stage
 * layout supplies it, bound to the one scene it hosts; outside a stage it does nothing, so a list
 * rendered alone needs no globe.
 */
export interface MarkerHighlight {
	/** Emphasizes this mountain's marker until called again; `undefined` ends it. */
	highlight(slug: string | undefined): void;
}

const NO_HIGHLIGHT: MarkerHighlight = { highlight: () => {} };

const MarkerHighlightContext = createContext<MarkerHighlight>(NO_HIGHLIGHT);

export const MarkerHighlightProvider = MarkerHighlightContext.Provider;

export function useMarkerHighlight(): MarkerHighlight {
	return useContext(MarkerHighlightContext);
}
