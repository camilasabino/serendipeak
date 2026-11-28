import { mountainCount } from './atlasCopy';
import type { RangeOption } from './atlasFilter';
import styles from './RangeNavigation.module.css';

/**
 * Ranges the reader can go into, one button each. They lead further down the tree rather than to
 * a page, so they read as interface rows with an arrow, apart from the mountains' own rows.
 */
export function RangeChoices({
	ranges,
	onChoose,
	labelledBy
}: {
	ranges: readonly RangeOption[];
	onChoose: (slug: string) => void;
	labelledBy?: string;
}) {
	return (
		<ul className={styles.choices} aria-labelledby={labelledBy}>
			{ranges.map((range) => (
				<li key={range.slug}>
					<button type="button" className={styles.choice} onClick={() => onChoose(range.slug)}>
						<span className={styles.choiceName}>{range.name}</span>
						<span className={styles.count}>{mountainCount(range.count)}</span>
						<svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true">
							<path d="M9 6l6 6-6 6" />
						</svg>
					</button>
				</li>
			))}
		</ul>
	);
}
