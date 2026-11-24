import Router from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { bindRouteChanges, createNavigate } from '../explore/navigate';
import type { AtlasMarker } from '../stage/globe/atlasMarkers';
import type { MarkerActivation } from '../stage/globe/markerActivation';

/** An ambiguous press on the globe, waiting for the reader to say which mountain they meant. */
export type MarkerChoice = Extract<MarkerActivation, { kind: 'choice' }>;

export interface MarkerActivationState {
	/** The open chooser, if a press was ambiguous. */
	choice: MarkerChoice | undefined;
	activate: (activation: MarkerActivation) => void;
	dismiss: () => void;
}

const navigate = createNavigate(() => Router);

/** Whether every mountain a chooser lists is still on the globe. */
export function choiceIsCurrent(choice: MarkerChoice, markers: readonly AtlasMarker[]): boolean {
	const shown = new Set(markers.map(({ slug }) => slug));

	return choice.mountains.every(({ slug }) => shown.has(slug));
}

/**
 * What a press on an atlas marker does: one mountain opens its page at once, exactly as its
 * link in the list does; several ask first. Nothing is selected on the atlas itself, and any
 * route change, leaving the atlas, or a filter that removes one of the listed mountains from the
 * globe closes a chooser left open. `markers` are the ones on the globe; undefined off the atlas.
 */
export function useMarkerActivation(
	markers: readonly AtlasMarker[] | undefined
): MarkerActivationState {
	const [choice, setChoice] = useState<MarkerChoice | undefined>(undefined);
	if (choice && (!markers || !choiceIsCurrent(choice, markers))) {
		setChoice(undefined);
	}

	useEffect(() => bindRouteChanges(Router.events, () => setChoice(undefined)), []);

	const activate = useCallback((activation: MarkerActivation) => {
		if (activation.kind === 'choice') {
			setChoice(activation);
			return;
		}
		setChoice(undefined);
		navigate(activation.mountain.slug).catch((error: unknown) => {
			console.error('Opening the mountain page failed', error);
		});
	}, []);

	const dismiss = useCallback(() => setChoice(undefined), []);

	return { choice, activate, dismiss };
}
