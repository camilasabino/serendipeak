import { useRef } from 'react';
import type { Mountain } from '../api/contract';
import { AtlasReturnLink } from '../atlas/AtlasReturnLink';
import { ExploreControl } from '../explore/ExploreControl';
import type { NearbyMountain } from '../nearby/findNearbyMountains';
import { NearbyMountains } from '../nearby/NearbyMountains';
import { ContourMotif } from '../shell/ContourMotif';
import { CLOSING_CONTOURS } from '../shell/contourPatterns';
import { MountainInfoPanel } from './MountainInfoPanel';
import styles from './MountainView.module.css';
import { MountainPhoto } from './MountainPhoto';
import { ShareControl } from './ShareControl';
import { useSheetScrollReset } from './sheetScroll';
import { mountainShare } from './socialMetadata';
import { DAILY_CLOSING_NOTE, DAILY_CUE, PREVIEW_NOTICE } from './pageCopy';

interface MountainViewProps {
	mountain: Mountain;
	daily: boolean;
	preview?: boolean;
	siteOrigin?: string | null;
	nearby?: readonly NearbyMountain[];
}

export function MountainView({
	mountain,
	daily,
	preview = false,
	siteOrigin = null,
	nearby = []
}: MountainViewProps) {
	const { primaryImage } = mountain;
	const sheet = useRef<HTMLDivElement>(null);
	useSheetScrollReset(sheet, mountain.slug);

	const share = preview ? undefined : mountainShare(mountain.slug, siteOrigin);
	const runningHead = !daily && !preview && <AtlasReturnLink />;

	return (
		<div ref={sheet} className={`${styles.sheet} ${styles.page}`}>
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
				related={<NearbyMountains mountains={nearby} />}
			/>
			{daily && (
				<div className={styles.closing}>
					<ContourMotif pattern={CLOSING_CONTOURS} level="index" className={styles.closingMotif} />
					<p className={styles.cue}>{DAILY_CUE}</p>
					<p className={styles.closingNote}>{DAILY_CLOSING_NOTE}</p>
				</div>
			)}
		</div>
	);
}
