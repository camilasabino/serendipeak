import { useSyncExternalStore } from 'react';
import { EXPLORE_LABEL, EXPLORING_LABEL } from './exploreCopy';
import styles from './ExploreControl.module.css';
import type { ExploreState } from './Explorer';
import { useExplorer } from './useExplorer';

interface ExploreButtonProps {
	slug: string;
	state: ExploreState;
	onExplore: () => void;
}

// Stays focusable while busy: the explorer ignores repeated activations itself.
export function ExploreButton({ slug, state, onExplore }: ExploreButtonProps) {
	const busy = state.status === 'loading';

	return (
		<>
			<button
				type="button"
				className={styles.explore}
				aria-busy={busy}
				aria-disabled={busy}
				onClick={onExplore}
			>
				{busy ? EXPLORING_LABEL : EXPLORE_LABEL}
				{!busy && <span aria-hidden="true">→</span>}
			</button>
			{state.status === 'failed' && state.from === slug && (
				<p className={styles.error} role="alert">
					{state.message}
				</p>
			)}
		</>
	);
}

export function ExploreControl({ slug }: { slug: string }) {
	const explorer = useExplorer();
	const state = useSyncExternalStore(
		explorer.subscribe,
		explorer.getSnapshot,
		explorer.getSnapshot
	);

	return <ExploreButton slug={slug} state={state} onExplore={() => void explorer.explore(slug)} />;
}
