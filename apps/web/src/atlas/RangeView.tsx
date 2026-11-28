import type { ReactNode } from 'react';
import { RANGE_MOUNTAINS_LABEL, SUBRANGES_LABEL } from './atlasCopy';
import type { RangeOption } from './atlasFilter';
import { RangeChoices } from './RangeChoices';
import styles from './RangeNavigation.module.css';

export const SUBRANGES_HEADING_ID = 'atlas-subranges-heading';
export const RANGE_MOUNTAINS_HEADING_ID = 'atlas-range-mountains-heading';

/**
 * What a range holds, below the context that names it: the subranges directly below it, each a
 * way further down, then the mountains it holds, those of its subranges included, as `children`.
 * Under a range with no subranges the mountains follow with no label of their own.
 */
export function RangeView({
	subranges,
	onChoose,
	children
}: {
	subranges: readonly RangeOption[];
	onChoose: (slug: string) => void;
	children: ReactNode;
}) {
	return (
		<div>
			{subranges.length > 0 && (
				<section aria-labelledby={SUBRANGES_HEADING_ID}>
					<h3 id={SUBRANGES_HEADING_ID} className={styles.label}>
						{SUBRANGES_LABEL}
					</h3>
					<RangeChoices ranges={subranges} onChoose={onChoose} labelledBy={SUBRANGES_HEADING_ID} />
				</section>
			)}
			{subranges.length > 0 && (
				<h3 id={RANGE_MOUNTAINS_HEADING_ID} className={styles.label}>
					{RANGE_MOUNTAINS_LABEL}
				</h3>
			)}
			{children}
		</div>
	);
}
