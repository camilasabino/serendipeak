import { Component, type ReactNode } from 'react';
import { INITIALIZATION_FAILED_STATE } from './sceneState';
import type { SceneStore } from './SceneStore';
import { SceneStatus } from './SceneStatus';

// Carries the loader's own reload, the one recovery that can bring a failed chunk back.
export class StageChunkLoadError extends Error {
	constructor(
		cause: unknown,
		readonly reload: (() => void) | undefined
	) {
		super('The mountain stage code failed to load.', { cause });
		this.name = 'StageChunkLoadError';
	}
}

interface StageBoundaryProps {
	store: SceneStore;
	children: ReactNode;
}

interface StageBoundaryState {
	failed: { reload: (() => void) | undefined } | undefined;
}

// Keeps a stage failure away from the editorial content: only the stage is replaced.
export class StageBoundary extends Component<StageBoundaryProps, StageBoundaryState> {
	state: StageBoundaryState = { failed: undefined };

	static getDerivedStateFromError(error: unknown): StageBoundaryState {
		return { failed: { reload: error instanceof StageChunkLoadError ? error.reload : undefined } };
	}

	componentDidCatch(error: unknown): void {
		console.error('The mountain stage failed', error);
		this.props.store.setState(INITIALIZATION_FAILED_STATE);
	}

	// An arrow property because it is handed to a button as a detached callback.
	readonly retry = (): void => {
		this.state.failed?.reload?.();
		this.props.store.setState({ status: 'loading' });
		this.setState({ failed: undefined });
	};

	render(): ReactNode {
		if (this.state.failed) {
			return <SceneStatus state={INITIALIZATION_FAILED_STATE} onRetry={this.retry} />;
		}

		return this.props.children;
	}
}
