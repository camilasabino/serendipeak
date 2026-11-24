import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { Mountain } from '../api/contract';
import { ExternalLink } from '../links/ExternalLink';
import { formatElevationValue } from '../formatElevation';
import { useUnitSystem } from '../units/UnitPreferenceContext';
import { elevationUnit } from '../units/unitSystem';
import {
	distinctCountryNames,
	formatCoordinates,
	formatCountries,
	formatPlaceParts,
	formatRegionPath,
	splitParagraphs
} from './format';
import { googleMapsUrl } from './googleMaps';
import { MOUNTAIN_HEADING_ID } from './focusMountainHeading';
import styles from './MountainInfoPanel.module.css';

interface MountainInfoPanelProps {
	mountain: Mountain;
	/** The photograph, placed between the place line and the lede. */
	plate?: ReactNode;
	/** The page's primary action, placed after the facts so it closes the reading. */
	action?: ReactNode;
}

export function MountainInfoPanel({ mountain, plate, action }: MountainInfoPanelProps) {
	const { continent, coordinates, countries, region, summary, description } = mountain;
	const formattedCoordinates = formatCoordinates(coordinates);
	const countryNames = distinctCountryNames(continent, countries);

	return (
		<>
			<div className={styles.masthead}>
				<h1 id={MOUNTAIN_HEADING_ID} tabIndex={-1} className={styles.name}>
					{mountain.name}
				</h1>
				<ElevationFigure meters={mountain.elevationMeters} />
				<PlaceLine parts={formatPlaceParts(continent, countries, region)} />
			</div>
			<section aria-labelledby={MOUNTAIN_HEADING_ID} className={styles.body}>
				{plate}
				{summary && <p className={styles.lede}>{summary}</p>}
				<Facts>
					{region && <Fact term="Region">{formatRegionPath(region)}</Fact>}
					{countryNames.length > 0 && (
						<Fact term={countryNames.length === 1 ? 'Country' : 'Countries'}>
							{formatCountries(countryNames)}
						</Fact>
					)}
					<Fact term="Continent">{continent.name}</Fact>
					<Fact term="Coordinates">
						<ExternalLink
							href={googleMapsUrl(coordinates.latitude, coordinates.longitude)}
							aria-label={`${formattedCoordinates} on Google Maps`}
						>
							{formattedCoordinates}
						</ExternalLink>
					</Fact>
				</Facts>
				{description && <Description key={mountain.slug} text={description} />}
				{action && <div className={styles.action}>{action}</div>}
			</section>
		</>
	);
}

function Description({ text }: { text: string }) {
	const [first, ...rest] = splitParagraphs(text);
	const [expanded, setExpanded] = useState(false);
	const moreId = useId();
	const toggle = useRef<HTMLButtonElement>(null);
	const collapsedByVisitor = useRef(false);

	useEffect(() => {
		if (!collapsedByVisitor.current) return;
		collapsedByVisitor.current = false;
		// The control moves up when the text folds; keep it on screen without scrolling when it already is.
		toggle.current?.scrollIntoView({ block: 'nearest' });
	}, [expanded]);

	if (first === undefined) return null;

	return (
		<div className={styles.description}>
			<p>{first}</p>
			{rest.length > 0 && (
				<>
					<div id={moreId} hidden={!expanded} className={styles.more}>
						{rest.map((paragraph, index) => (
							<p key={index}>{paragraph}</p>
						))}
					</div>
					<button
						ref={toggle}
						type="button"
						className={styles.toggle}
						aria-expanded={expanded}
						aria-controls={moreId}
						onClick={() => {
							collapsedByVisitor.current = expanded;
							setExpanded(!expanded);
						}}
					>
						{expanded ? 'Show less' : 'Read more'}
					</button>
				</>
			)}
		</div>
	);
}

function ElevationFigure({ meters }: { meters: number }) {
	const system = useUnitSystem();

	return (
		<p className={styles.figure}>
			<svg className={styles.glyph} viewBox="0 0 14 13" aria-hidden="true">
				<path
					d="M6.20 2.39Q7.00 1.00 7.80 2.39L11.92 9.51Q12.72 10.90 11.12 10.90L2.88 10.90Q1.28 10.90 2.08 9.51Z"
					fill="currentColor"
				/>
			</svg>
			<span className={styles.hidden}>Elevation </span>
			<span className={styles.num}>{formatElevationValue(meters, system)}</span>{' '}
			<span className={styles.unit}>{elevationUnit(system)}</span>
		</p>
	);
}

function PlaceLine({ parts }: { parts: string[] }) {
	return (
		<p className={styles.place}>
			{parts.map((part, index) => (
				<Fragment key={`${index}:${part}`}>
					{index > 0 && ' '}
					<span className={styles.part}>
						{part}
						{index < parts.length - 1 && (
							<span className={styles.separator} aria-hidden="true">
								·
							</span>
						)}
					</span>
				</Fragment>
			))}
		</p>
	);
}

export function Facts({ children }: { children: ReactNode }) {
	return <dl className={styles.facts}>{children}</dl>;
}

export function Fact({ term, children }: { term: string; children: ReactNode }) {
	return (
		<div className={styles.fact}>
			<dt>{term}</dt>
			<dd>{children}</dd>
		</div>
	);
}
