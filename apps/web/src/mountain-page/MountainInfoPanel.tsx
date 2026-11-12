import type { ReactNode } from 'react';
import type { Mountain } from '../api/contract';
import { ExternalLink } from '../links/ExternalLink';
import { formatElevation } from '../formatElevation';
import { formatCoordinates, formatCountries, formatRegion } from './format';
import { googleMapsUrl } from './googleMaps';
import { MOUNTAIN_HEADING_ID } from './focusMountainHeading';
import styles from './MountainInfoPanel.module.css';

export function MountainInfoPanel({ mountain }: { mountain: Mountain }) {
	const { continent, coordinates, countries, region, summary } = mountain;
	const formattedCoordinates = formatCoordinates(coordinates);

	return (
		<section aria-labelledby={MOUNTAIN_HEADING_ID}>
			<h1 id={MOUNTAIN_HEADING_ID} tabIndex={-1} className={styles.name}>
				{mountain.name}
			</h1>
			{summary && <p className={styles.summary}>{summary}</p>}
			<Facts>
				<Fact term="Continent">{continent.name}</Fact>
				{countries.length > 0 && (
					<Fact term={countries.length === 1 ? 'Country' : 'Countries'}>
						{formatCountries(countries.map((country) => country.name))}
					</Fact>
				)}
				{region && <Fact term="Region">{formatRegion(region)}</Fact>}
				<Fact term="Elevation">{formatElevation(mountain.elevationMeters)}</Fact>
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
