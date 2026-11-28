import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { mountainHref } from '../explore/navigate';
import { useUnitSystem } from '../units/UnitPreferenceContext';
import { describeEntry } from '../mountain-index/describeEntry';
import {
	ALL_CONTINENTS_LABEL,
	ATLAS_SECTION_LABEL,
	BROWSE_BY_CONTINENT_LABEL,
	NO_MATCHES_HINT,
	NO_MATCHES_TITLE,
	browseByContinentAccessibleLabel,
	continentMountainsLabel,
	continentRangesHeading,
	flatHeading,
	mountainCount
} from './atlasCopy';
import { DEFAULT_ATLAS_SORT } from './atlasSort';
import { AtlasContext, LIST_HEADING_ID, type TrailStep } from './AtlasContext';
import styles from './AtlasList.module.css';
import { ContinentMountainsView, ContinentRangesView } from './ContinentRanges';
import type { ContinentGroup } from './groupByContinent';
import { useMarkerHighlight, type MarkerHighlight } from './MarkerHighlightContext';
import { useOpenContinents } from './OpenContinentsContext';
import { RANGE_MOUNTAINS_HEADING_ID, RangeView } from './RangeView';
import { continentNames, subrangeOf, type RangeNavigation } from './rangeNavigation';
import { rowHighlight } from './rowHighlight';

/** The flat list of matches that a filter or a sort leaves in place of the continents. */
export interface FlatList {
	heading: string;
	/** Whether going back to the continents clears filters as well as the sort. */
	clearsFilters: boolean;
	/** Goes back to browsing by continent; absent until the page is interactive. */
	onReturn?: () => void;
}

/** Where focus returns to when the reader comes back to all continents from one of them. */
export function continentEntryId(code: string): string {
	return `atlas-continent-entry-${code}`;
}

export function listItemId(slug: string): string {
	return `atlas-item-${slug}`;
}

/**
 * The catalog by continent. Until the page is interactive each continent is a native disclosure:
 * it opens without JavaScript and its mountains, plain links to their pages, stay in the
 * server-rendered document. Once interactive the continents are a list of entries, one level of
 * navigation at a time: all continents, one continent's mountains, its mountain ranges, and a
 * range with its subranges and mountains. Each level opens with where the reader is, which comes
 * before the controls that filter and sort it. A row the pointer or the keyboard rests on has its
 * marker emphasized on the globe, which is supplementary: the row says everything the marker does.
 */
export function AtlasList({
	groups,
	results,
	toolbar,
	ranges,
	flat
}: {
	groups: readonly ContinentGroup[];
	/** The mountains to list flat, in order, in place of the continents; empty says nothing matched. */
	results?: readonly MountainIndexEntry[];
	/** Laid between where the reader is and the list. */
	toolbar?: ReactNode;
	ranges?: RangeNavigation;
	flat?: FlatList;
}) {
	const open = useOpenContinents();
	const { highlight } = useMarkerHighlight();

	// Leaving the list, by navigation or by the atlas going away, ends any emphasis it asked for.
	useEffect(() => () => highlight(undefined), [highlight]);

	const mountainList = (items: readonly MountainIndexEntry[], labelledBy: string) =>
		items.length === 0 ? (
			<div className={styles.empty}>
				<p className={styles.emptyTitle}>{NO_MATCHES_TITLE}</p>
				<p className={styles.emptyHint}>{NO_MATCHES_HINT}</p>
			</div>
		) : (
			<ul className={styles.results} aria-labelledby={labelledBy}>
				{items.map((mountain) => (
					<li key={mountain.slug}>
						<MountainRow
							mountain={mountain}
							highlight={highlight}
							subrange={ranges?.place && subrangeOf(mountain, ranges.place.range.slug)}
						/>
					</li>
				))}
			</ul>
		);
	const place = ranges?.place;
	const continent = ranges?.continent;

	let initial = false;
	let heading: string;
	let meta: string | undefined;
	let steps: TrailStep[] = [];
	let body: ReactNode;

	if (ranges && place) {
		const { trail, range, subranges } = place;
		const { origin } = ranges;
		const held = continentNames(results ?? []);
		heading = range.name;
		meta = [mountainCount(range.count), ...(held.length > 1 ? held : [])].join(' · ');
		// The way up begins at the level of the continent the reader came from, if they came from
		// one, and else at the atlas; then each range above this one, to which it can climb directly.
		const first: TrailStep = origin
			? {
					label: origin.ranges
						? continentRangesHeading(origin.name)
						: continentMountainsLabel(origin.name),
					onSelect: () => ranges.browseContinent({ code: origin.code, ranges: origin.ranges })
				}
			: { label: ranges.atlasLabel, onSelect: () => ranges.choose(null) };
		steps = [
			first,
			...trail.slice(0, -1).map(({ slug, name }) => ({
				label: name,
				onSelect: () => ranges.choose(slug)
			}))
		];
		body = (
			<RangeView subranges={subranges} onChoose={ranges.choose}>
				{mountainList(
					results ?? [],
					subranges.length > 0 ? RANGE_MOUNTAINS_HEADING_ID : LIST_HEADING_ID
				)}
			</RangeView>
		);
	} else if (ranges && continent?.showRanges) {
		heading = continentRangesHeading(continent.name);
		steps = [
			{
				label: continentMountainsLabel(continent.name),
				onSelect: () => ranges.browseContinent({ code: continent.code, ranges: false })
			}
		];
		body = <ContinentRangesView ranges={continent.ranges} onChoose={ranges.choose} />;
	} else if (ranges && continent) {
		heading = continentMountainsLabel(continent.name);
		meta = mountainCount(continent.mountains.length);
		steps = [{ label: ranges.atlasLabel, onSelect: () => ranges.browseContinent(null) }];
		body = (
			<ContinentMountainsView
				continent={continent}
				hasRanges={continent.ranges.length > 0}
				onBrowseRanges={() => ranges.browseContinent({ code: continent.code, ranges: true })}
			>
				{mountainList(continent.mountains, LIST_HEADING_ID)}
			</ContinentMountainsView>
		);
	} else if (results !== undefined) {
		const onReturn = flat?.onReturn;
		const clearsFilters = flat?.clearsFilters ?? true;
		heading = flat?.heading ?? flatHeading(false, DEFAULT_ATLAS_SORT);
		if (onReturn) {
			steps = [
				{
					label: BROWSE_BY_CONTINENT_LABEL,
					accessibleLabel: browseByContinentAccessibleLabel(clearsFilters),
					onSelect: onReturn
				}
			];
		}
		body = mountainList(results, LIST_HEADING_ID);
	} else {
		initial = true;
		heading = ALL_CONTINENTS_LABEL;
		body = ranges ? (
			<ul className={styles.index} aria-labelledby={LIST_HEADING_ID}>
				{groups.map(({ code, name, mountains }) => (
					<li key={code}>
						<button
							type="button"
							id={continentEntryId(code)}
							className={`${styles.continent} ${styles.continentButton}`}
							onClick={() => ranges.browseContinent({ code, ranges: false })}
						>
							<span className={styles.continentName}>{name}</span>
							<span className={styles.count}>{mountainCount(mountains.length)}</span>
							<svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true">
								<path d="M9 6l6 6-6 6" />
							</svg>
						</button>
					</li>
				))}
			</ul>
		) : (
			groups.map((group) => (
				<Continent key={group.code} group={group} open={open} highlight={highlight} />
			))
		);
	}

	return (
		<section
			className={initial ? styles.list : `${styles.list} ${styles.listInContext}`}
			aria-label={ATLAS_SECTION_LABEL}
		>
			<AtlasContext heading={heading} meta={meta} steps={steps} initial={initial} />
			{toolbar}
			{body}
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
						<MountainRow mountain={mountain} highlight={highlight} />
					</li>
				))}
			</ul>
		</details>
	);
}

function MountainRow({
	mountain,
	highlight,
	subrange
}: {
	mountain: MountainIndexEntry;
	highlight: MarkerHighlight['highlight'];
	/** The subrange of the range being browsed that the mountain sits in, when it is not in the range itself. */
	subrange?: string;
}) {
	const unitSystem = useUnitSystem();

	return (
		<Link
			id={listItemId(mountain.slug)}
			className={styles.item}
			href={mountainHref(mountain.slug)}
			prefetch={false}
			{...rowHighlight(highlight, mountain.slug)}
		>
			<span className={styles.name}>{mountain.name}</span>
			<span className={styles.detail}>
				{subrange && `${subrange} · `}
				{describeEntry(mountain, unitSystem)}
			</span>
		</Link>
	);
}
