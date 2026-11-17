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
}

// Stays focusable while busy: the explorer ignores repeated activations itself.
export function ExploreButton({ slug, state, onExplore, buttonRef }: ExploreButtonProps) {
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
				<span>{busy ? EXPLORING_LABEL : EXPLORE_LABEL}</span>
				<span className={styles.disc} aria-hidden="true">
					<svg
						className={styles.arrow}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2"
						strokeLinecap="round"
						strokeLinejoin="round"
					>
						<path d="M6 12h12M13 7l5 5-5 5" />
					</svg>
				</span>
			</button>
			{state.status === 'failed' && state.from === slug && (
				<p className={styles.error} role="alert">
					<svg
						className={styles.errorIcon}
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.75"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<circle cx="12" cy="12" r="8.5" />
						<path d="M12 7.5v5.5" />
						<circle cx="12" cy="16.3" r=".7" fill="currentColor" />
					</svg>
					<span>{state.message}</span>
				</p>
			)}
		</>
	);
}

export function ExploreControl({ slug }: { slug: string }) {
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
			onExplore={() => void explorer.explore(slug)}
		/>
	);
}
