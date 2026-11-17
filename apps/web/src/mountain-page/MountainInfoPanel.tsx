import { Fragment, type ReactNode } from 'react';
import type { Mountain } from '../api/contract';
import { ExternalLink } from '../links/ExternalLink';
import { formatElevationValue } from '../formatElevation';
import {
	distinctCountryNames,
	formatCoordinates,
	formatCountries,
	formatPlaceParts,
	formatRegion
} from './format';
import { googleMapsUrl } from './googleMaps';
import { MOUNTAIN_HEADING_ID } from './focusMountainHeading';
import styles from './MountainInfoPanel.module.css';

interface MountainInfoPanelProps {
	mountain: Mountain;
	/** The photograph, placed between the place line and the lede. */
	plate?: ReactNode;
	/** The page's primary action, placed between the lede and the facts. */
	action?: ReactNode;
}

export function MountainInfoPanel({ mountain, plate, action }: MountainInfoPanelProps) {
	const { continent, coordinates, countries, region, summary } = mountain;
	const formattedCoordinates = formatCoordinates(coordinates);
	const countryNames = distinctCountryNames(continent, countries);

	return (
		<section aria-labelledby={MOUNTAIN_HEADING_ID}>
			<div className={styles.masthead}>
				<h1 id={MOUNTAIN_HEADING_ID} tabIndex={-1} className={styles.name}>
					{mountain.name}
				</h1>
				<ElevationFigure meters={mountain.elevationMeters} />
				<PlaceLine parts={formatPlaceParts(continent, countries, region)} />
			</div>
			{plate}
			{summary && <p className={styles.lede}>{summary}</p>}
			{action && <div className={styles.action}>{action}</div>}
			<Facts>
				{region && <Fact term="Region">{formatRegion(region)}</Fact>}
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
		</section>
	);
}

function ElevationFigure({ meters }: { meters: number }) {
	return (
		<p className={styles.figure}>
			<svg className={styles.glyph} viewBox="0 0 14 13" aria-hidden="true">
				<path
					d="M6.20 2.39Q7.00 1.00 7.80 2.39L11.92 9.51Q12.72 10.90 11.12 10.90L2.88 10.90Q1.28 10.90 2.08 9.51Z"
					fill="currentColor"
				/>
			</svg>
			<span className={styles.hidden}>Elevation </span>
			<span className={styles.num}>{formatElevationValue(meters)}</span>{' '}
			<span className={styles.unit}>m</span>
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
