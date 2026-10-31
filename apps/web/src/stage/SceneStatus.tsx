import type { SceneState } from './sceneState';
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

export function SceneStatus({ state, onRetry }: SceneStatusProps) {
	if (state.status === 'failed') {
		return (
			<div role="alert" className={styles.notice}>
				<p>{FAILURE_MESSAGES[state.failure]}</p>
				<p className={styles.hint}>{DETAILS_AVAILABLE_MESSAGE}</p>
				{onRetry && (
					<button type="button" className={styles.retry} onClick={onRetry}>
						{RETRY_LABEL}
					</button>
				)}
			</div>
		);
	}

	if (state.status === 'ready' && state.imageryDegraded) {
		return (
			<div role="status" className={`${styles.notice} ${styles.polite}`}>
				<p>{IMAGERY_DEGRADED_MESSAGE}</p>
				<p className={styles.hint}>{DETAILS_AVAILABLE_MESSAGE}</p>
			</div>
		);
	}

	return null;
}
