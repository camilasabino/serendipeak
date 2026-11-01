import { useEffect, useRef, type MouseEvent } from 'react';
import type { SceneFailure, SceneState } from './sceneState';
import styles from './SceneStatus.module.css';
import {
	DETAILS_AVAILABLE_MESSAGE,
	FAILURE_MESSAGES,
	IMAGERY_DEGRADED_MESSAGE,
	RETRY_LABEL
} from './stageCopy';

interface SceneStatusProps {
	state: SceneState;
	onRetry?: () => void;
}

// The anchor is StageShell's root, the one stage element that outlives a reload of the scene.
function stageOf(element: Element): HTMLElement | null {
	return element.closest<HTMLElement>('[data-stage]');
}

function FailureNotice({ failure, onRetry }: { failure: SceneFailure; onRetry?: () => void }) {
	const retryButton = useRef<HTMLButtonElement>(null);

	// A retry that fails again mounts a new button; the keyboard user who just pressed the previous
	// one is waiting on the stage anchor and must find the control again where they left off.
	useEffect(() => {
		const retry = retryButton.current;
		if (retry && document.activeElement === stageOf(retry)) {
			retry.focus();
		}
	}, []);

	// The pressed button leaves the document as soon as the stage reloads, which would drop focus
	// on <body>; the stable stage anchor keeps it, and Tab continues from there.
	function retry(event: MouseEvent<HTMLButtonElement>) {
		stageOf(event.currentTarget)?.focus({ preventScroll: true });
		onRetry?.();
	}

	return (
		<div role="alert" className={styles.notice}>
			<p>{FAILURE_MESSAGES[failure]}</p>
			<p className={styles.hint}>{DETAILS_AVAILABLE_MESSAGE}</p>
			{onRetry && (
				<button type="button" className={styles.retry} ref={retryButton} onClick={retry}>
					{RETRY_LABEL}
				</button>
			)}
		</div>
	);
}

// The status region stays mounted while the scene is not failed: a live region that is inserted
// already populated is not reliably announced.
export function SceneStatus({ state, onRetry }: SceneStatusProps) {
	if (state.status === 'failed') {
		return <FailureNotice failure={state.failure} onRetry={onRetry} />;
	}

	const degraded = state.status === 'ready' && state.imageryDegraded;

	return (
		<div role="status" className={degraded ? `${styles.notice} ${styles.polite}` : undefined}>
			{degraded && (
				<>
					<p>{IMAGERY_DEGRADED_MESSAGE}</p>
					<p className={styles.hint}>{DETAILS_AVAILABLE_MESSAGE}</p>
				</>
			)}
		</div>
	);
}
