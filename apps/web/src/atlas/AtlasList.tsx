import Link from 'next/link';
import { useState } from 'react';
import { mountainHref } from '../explore/navigate';
import { describeEntry } from '../mountain-index/describeEntry';
import { ATLAS_LIST_HEADING, mountainCount } from './atlasCopy';
import styles from './AtlasList.module.css';
import type { ContinentGroup } from './groupByContinent';
import { useOpenContinents } from './OpenContinentsContext';

export function listItemId(slug: string): string {
	return `atlas-item-${slug}`;
}

/**
 * The catalog by continent, each a native disclosure: it opens by keyboard and touch without
 * JavaScript, and its mountains stay in the server-rendered document while it is closed. Each
 * mountain is a plain link to its page, where the stage flies to it.
 */
export function AtlasList({ groups }: { groups: readonly ContinentGroup[] }) {
	const open = useOpenContinents();

	return (
		<section className={styles.list} aria-labelledby="atlas-list-heading">
			<h2 id="atlas-list-heading" className={styles.heading}>
				{ATLAS_LIST_HEADING}
			</h2>
			{groups.map((group) => (
				<Continent key={group.code} group={group} open={open} />
			))}
		</section>
	);
}

function Continent({ group, open }: { group: ContinentGroup; open: Set<string> }) {
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
			}}
		>
			<summary className={styles.continent}>
				<span id={headingId} className={styles.continentName}>
					{name}
				</span>
				<span className={styles.count}>{mountainCount(mountains.length)}</span>
			</summary>
			<ul className={styles.items} aria-labelledby={headingId}>
				{mountains.map((mountain) => (
					<li key={mountain.slug}>
						<Link
							id={listItemId(mountain.slug)}
							className={styles.item}
							href={mountainHref(mountain.slug)}
							prefetch={false}
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
