import { useRef, useSyncExternalStore, type Ref } from 'react';
import { EXPLORE_LABEL, EXPLORING_LABEL } from './exploreCopy';
import styles from './ExploreControl.module.css';
import type { ExploreState } from './Explorer';
import { useExplorer } from './useExplorer';

interface ExploreButtonProps {
	slug: string;
	state: ExploreState;
	onExplore: () => void;
	buttonRef?: Ref<HTMLButtonElement>;
	placement?: 'header' | 'panel';
}

// Stays focusable while busy: the explorer ignores repeated activations itself.
export function ExploreButton({
	slug,
	state,
	onExplore,
	buttonRef,
	placement = 'header'
}: ExploreButtonProps) {
	const busy = state.status === 'loading';

	return (
		<>
			<button
				ref={buttonRef}
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
				<p
					className={placement === 'panel' ? `${styles.error} ${styles.inlineError}` : styles.error}
					role="alert"
				>
					{state.message}
				</p>
			)}
		</>
	);
}

interface ExploreControlProps {
	slug: string;
	placement?: 'header' | 'panel';
}

export function ExploreControl({ slug, placement }: ExploreControlProps) {
	const buttonRef = useRef<HTMLButtonElement>(null);
	const explorer = useExplorer(buttonRef);
	const state = useSyncExternalStore(
		explorer.subscribe,
		explorer.getSnapshot,
		explorer.getSnapshot
	);

	return (
		<ExploreButton
			slug={slug}
			state={state}
			buttonRef={buttonRef}
			placement={placement}
			onExplore={() => void explorer.explore(slug)}
		/>
	);
}
