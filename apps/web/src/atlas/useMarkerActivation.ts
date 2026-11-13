import Router from 'next/router';
import { useCallback, useEffect, useState } from 'react';
import { bindRouteChanges, createNavigate } from '../explore/navigate';
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

/**
 * What a press on an atlas marker does: one mountain opens its page at once, exactly as its
 * link in the list does; several ask first. Nothing is selected on the atlas itself, and any
 * route change, or leaving the atlas, closes a chooser left open.
 */
export function useMarkerActivation(onAtlas: boolean): MarkerActivationState {
	const [choice, setChoice] = useState<MarkerChoice | undefined>(undefined);
	if (!onAtlas && choice) {
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
