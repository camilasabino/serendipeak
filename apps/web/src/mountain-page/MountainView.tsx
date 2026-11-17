import type { Mountain } from '../api/contract';
import { AtlasReturnLink } from '../atlas/AtlasReturnLink';
import { ExploreControl } from '../explore/ExploreControl';
import { DataSources } from './DataSources';
import { MountainInfoPanel } from './MountainInfoPanel';
import styles from './MountainView.module.css';
import { MountainPhoto } from './MountainPhoto';
import { ShareControl } from './ShareControl';
import { mountainShare } from './socialMetadata';
import { DAILY_CLOSING_NOTE, DAILY_CUE, DAILY_EYEBROW, PREVIEW_NOTICE } from './pageCopy';

interface MountainViewProps {
	mountain: Mountain;
	daily: boolean;
	preview?: boolean;
	siteOrigin?: string | null;
}

export function MountainView({
	mountain,
	daily,
	preview = false,
	siteOrigin = null
}: MountainViewProps) {
	const { primaryImage, sources } = mountain;

	const share = preview ? undefined : mountainShare(mountain.slug, siteOrigin);
	const runningHead = daily ? (
		<p className={styles.eyebrow}>{DAILY_EYEBROW}</p>
	) : (
		!preview && <AtlasReturnLink />
	);

	return (
		<div className={styles.sheet}>
			{(runningHead || share) && (
				<div className={styles.runhead}>
					{runningHead}
					{share && <ShareControl key={mountain.slug} title={mountain.name} share={share} />}
				</div>
			)}
			{preview && (
				<p className={styles.preview} role="note">
					{PREVIEW_NOTICE}
				</p>
			)}
			<MountainInfoPanel
				mountain={mountain}
				plate={primaryImage && <MountainPhoto image={primaryImage} mountainName={mountain.name} />}
				action={<ExploreControl slug={mountain.slug} />}
			/>
			<DataSources sources={sources} />
			{daily && (
				<div className={styles.closing}>
					<p className={styles.cue}>{DAILY_CUE}</p>
					<p className={styles.closingNote}>{DAILY_CLOSING_NOTE}</p>
				</div>
			)}
		</div>
	);
}
