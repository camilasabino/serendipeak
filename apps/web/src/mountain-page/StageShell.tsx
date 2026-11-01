import { useSyncExternalStore, type ReactNode } from 'react';
import { BrandMark } from '../shell/BrandMark';
import { sceneBlocksExperience } from '../stage/experience';
import type { SceneStore } from '../stage/SceneStore';
import { revealLabel } from './pageCopy';
import styles from './StageShell.module.css';
import { TopographicMotif } from './TopographicMotif';

interface StageShellProps {
	store: SceneStore;
	daily: boolean;
	className?: string;
	children?: ReactNode;
}

export function StageShell({ store, daily, className, children }: StageShellProps) {
	const { state } = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

	return (
		<div
			className={className ? `${styles.stage} ${className}` : styles.stage}
			tabIndex={-1}
			data-stage=""
		>
			{children}
			{sceneBlocksExperience(state) && (
				<div className={styles.loader} role="status">
					<TopographicMotif className={styles.motif} />
					<div className={styles.lockup}>
						<BrandMark size={64} />
						<p className={styles.name}>SerendiPeak</p>
						<p className={styles.label}>{revealLabel(daily)}</p>
					</div>
				</div>
			)}
		</div>
	);
}
