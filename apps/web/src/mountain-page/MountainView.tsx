import Link from 'next/link';
import type { Mountain } from '../api/contract';
import { DataSources } from './DataSources';
import { MountainInfoPanel } from './MountainInfoPanel';
import styles from './MountainView.module.css';
import { MountainPhoto } from './MountainPhoto';
import { DAILY_CUE, DAILY_EYEBROW, TODAY_LINK_LABEL } from './pageCopy';

interface MountainViewProps {
	mountain: Mountain;
	daily: boolean;
}

export function MountainView({ mountain, daily }: MountainViewProps) {
	const { primaryImage, sources } = mountain;

	return (
		<div className={styles.sheet}>
			{!daily && (
				<p className={styles.return}>
					<Link href="/">{TODAY_LINK_LABEL}</Link>
				</p>
			)}
			{daily && <p className={styles.eyebrow}>{DAILY_EYEBROW}</p>}
			<MountainInfoPanel mountain={mountain} />
			{primaryImage && <MountainPhoto image={primaryImage} mountainName={mountain.name} />}
			<DataSources sources={sources} />
			{daily && <p className={styles.cue}>{DAILY_CUE}</p>}
		</div>
	);
}
