import Link from 'next/link';
import { useEffect, useState } from 'react';
import { mountainHref } from '../explore/navigate';
import { describeEntry } from '../mountain-index/describeEntry';
import { ATLAS_LIST_HEADING, mountainCount } from './atlasCopy';
import styles from './AtlasList.module.css';
import type { ContinentGroup } from './groupByContinent';
import { useMarkerHighlight, type MarkerHighlight } from './MarkerHighlightContext';
import { useOpenContinents } from './OpenContinentsContext';
import { rowHighlight } from './rowHighlight';

export function listItemId(slug: string): string {
	return `atlas-item-${slug}`;
}

/**
 * The catalog by continent, each a native disclosure: it opens by keyboard and touch without
 * JavaScript, and its mountains stay in the server-rendered document while it is closed. Each
 * mountain is a plain link to its page, where the stage flies to it.
 *
 * Every continent starts closed; the ones a reader opens are remembered. A row the pointer or the
 * keyboard rests on has its marker emphasized on the globe, which is supplementary: the row says
 * everything the marker does.
 */
export function AtlasList({ groups }: { groups: readonly ContinentGroup[] }) {
	const open = useOpenContinents();
	const { highlight } = useMarkerHighlight();

	// Leaving the list, by navigation or by the atlas going away, ends any emphasis it asked for.
	useEffect(() => () => highlight(undefined), [highlight]);

	return (
		<section className={styles.list} aria-labelledby="atlas-list-heading">
			<h2 id="atlas-list-heading" className={styles.heading}>
				{ATLAS_LIST_HEADING}
			</h2>
			{groups.map((group) => (
				<Continent key={group.code} group={group} open={open} highlight={highlight} />
			))}
		</section>
	);
}

function Continent({
	group,
	open,
	highlight
}: {
	group: ContinentGroup;
	open: Set<string>;
	highlight: MarkerHighlight['highlight'];
}) {
	const { code, name, mountains } = group;
	const [expanded, setExpanded] = useState(() => open.has(code));
	const headingId = `atlas-continent-${code}`;

	return (
		<details
			className={styles.group}
			open={expanded}
			onToggle={(event) => {
				const next = event.currentTarget.open;
				if (next) {
					open.add(code);
				} else {
					open.delete(code);
				}
				setExpanded(next);
				if (!next) {
					highlight(undefined);
				}
			}}
		>
			<summary className={styles.continent}>
				<span id={headingId} className={styles.continentName}>
					{name}
				</span>
				<span className={styles.count}>{mountainCount(mountains.length)}</span>
				<svg className={styles.chevron} viewBox="0 0 24 24" aria-hidden="true">
					<path d="M6 9l6 6 6-6" />
				</svg>
			</summary>
			<ul className={styles.items} aria-labelledby={headingId}>
				{mountains.map((mountain) => (
					<li key={mountain.slug}>
						<Link
							id={listItemId(mountain.slug)}
							className={styles.item}
							href={mountainHref(mountain.slug)}
							prefetch={false}
							{...rowHighlight(highlight, mountain.slug)}
						>
							<span className={styles.name}>{mountain.name}</span>
							<span className={styles.detail}>{describeEntry(mountain)}</span>
						</Link>
					</li>
				))}
			</ul>
		</details>
	);
}
