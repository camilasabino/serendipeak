import { createContext, useContext } from 'react';
import type { TransitionCoordinator } from './TransitionCoordinator';

const TransitionCoordinatorContext = createContext<TransitionCoordinator | undefined>(undefined);

export const TransitionCoordinatorProvider = TransitionCoordinatorContext.Provider;

export function useTransitionCoordinator(): TransitionCoordinator {
	const coordinator = useContext(TransitionCoordinatorContext);
	if (!coordinator) {
		throw new Error('TransitionCoordinatorProvider is missing above this component.');
	}

	return coordinator;
}
