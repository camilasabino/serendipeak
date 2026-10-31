import { BrandMark } from '../shell/BrandMark';
import { revealLabel } from './pageCopy';
import styles from './StageShell.module.css';
import { TopographicMotif } from './TopographicMotif';

export function StageShell({ daily, className }: { daily: boolean; className?: string }) {
	return (
		<div className={className ? `${styles.stage} ${className}` : styles.stage}>
			<div className={styles.loader} role="status">
				<TopographicMotif className={styles.motif} />
				<div className={styles.lockup}>
					<BrandMark size={64} />
					<p className={styles.name}>SerendiPeak</p>
					<p className={styles.label}>{revealLabel(daily)}</p>
				</div>
			</div>
		</div>
	);
}
