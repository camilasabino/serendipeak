import type { ReactNode } from 'react';
import { BROWSE_RANGES_LABEL, NO_CONTINENT_RANGES_HINT, browseRangesLabel } from './atlasCopy';
import type { RangeOption } from './atlasFilter';
import { LIST_HEADING_ID } from './AtlasContext';
import { RangeChoices } from './RangeChoices';
import styles from './RangeNavigation.module.css';
import type { RangeContinent } from './rangeNavigation';

/** The way from a continent's mountains into its mountain ranges, the one action of that level. */
function ContinentRangesEntry({
	continent,
	onBrowse
}: {
	continent: RangeContinent;
	onBrowse: () => void;
}) {
	return (
		<button
			type="button"
			className={styles.entry}
			aria-label={browseRangesLabel(continent.name)}
			onClick={onBrowse}
		>
			<span className={styles.entryLabel}>{BROWSE_RANGES_LABEL}</span>
			<svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true">
				<path d="M9 6l6 6-6 6" />
			</svg>
		</button>
	);
}

/**
 * One continent's mountains, below the context that names it: when it has ranges to offer, the
 * way into them. The mountains follow as `children`.
 */
export function ContinentMountainsView({
	continent,
	hasRanges,
	onBrowseRanges,
	children
}: {
	continent: RangeContinent;
	hasRanges: boolean;
	onBrowseRanges: () => void;
	children: ReactNode;
}) {
	return (
		<div>
			{hasRanges && <ContinentRangesEntry continent={continent} onBrowse={onBrowseRanges} />}
			{children}
		</div>
	);
}

/**
 * The topmost mountain ranges of one continent, each however few mountains it holds, in place of
 * the continent's mountains. Choosing one goes into it.
 */
export function ContinentRangesView({
	ranges,
	onChoose
}: {
	ranges: readonly RangeOption[];
	onChoose: (slug: string) => void;
}) {
	return ranges.length > 0 ? (
		<RangeChoices ranges={ranges} onChoose={onChoose} labelledBy={LIST_HEADING_ID} />
	) : (
		<p className={styles.hint}>{NO_CONTINENT_RANGES_HINT}</p>
	);
}
