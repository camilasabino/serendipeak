import type { Mountain } from '../api/contract';
import { AtlasReturnLink } from '../atlas/AtlasReturnLink';
import { ExploreControl } from '../explore/ExploreControl';
import { DataSources } from './DataSources';
import { MountainInfoPanel } from './MountainInfoPanel';
import styles from './MountainView.module.css';
import { MountainPhoto } from './MountainPhoto';
import { DAILY_CUE, DAILY_EYEBROW, PREVIEW_NOTICE } from './pageCopy';

interface MountainViewProps {
	mountain: Mountain;
	daily: boolean;
	preview?: boolean;
}

export function MountainView({ mountain, daily, preview = false }: MountainViewProps) {
	const { primaryImage, sources } = mountain;

	return (
		<div className={styles.sheet}>
			{preview && (
				<p className={styles.preview} role="note">
					{PREVIEW_NOTICE}
				</p>
			)}
			{daily && <p className={styles.eyebrow}>{DAILY_EYEBROW}</p>}
			<MountainInfoPanel mountain={mountain} />
			<div className={styles.explore}>
				<ExploreControl slug={mountain.slug} placement="panel" />
			</div>
			{!daily && !preview && (
				<p className={styles.atlas}>
					<AtlasReturnLink />
				</p>
			)}
			{primaryImage && <MountainPhoto image={primaryImage} mountainName={mountain.name} />}
			<DataSources sources={sources} />
			{daily && <p className={styles.cue}>{DAILY_CUE}</p>}
		</div>
	);
}
