import type { ReactNode } from 'react';
import type { Mountain } from '../api/contract';
import { ExternalLink } from '../links/ExternalLink';
import { formatElevation } from '../formatElevation';
import { formatCoordinates, formatCountries } from './format';
import { googleMapsUrl } from './googleMaps';
import styles from './MountainInfoPanel.module.css';

export function MountainInfoPanel({ mountain }: { mountain: Mountain }) {
	const { coordinates, countries, rangeName, summary } = mountain;
	const formattedCoordinates = formatCoordinates(coordinates);

	return (
		<section aria-labelledby="mountain-name">
			<h1 id="mountain-name" className={styles.name}>
				{mountain.name}
			</h1>
			{summary && <p className={styles.summary}>{summary}</p>}
			<dl className={styles.facts}>
				{countries.length > 0 && (
					<Fact term={countries.length === 1 ? 'Country' : 'Countries'}>
						{formatCountries(countries)}
					</Fact>
				)}
				<Fact term="Elevation">{formatElevation(mountain.elevationMeters)}</Fact>
				{rangeName && <Fact term="Range">{rangeName}</Fact>}
				<Fact term="Coordinates">
					<ExternalLink
						href={googleMapsUrl(coordinates.latitude, coordinates.longitude)}
						aria-label={`${formattedCoordinates} on Google Maps`}
					>
						{formattedCoordinates}
					</ExternalLink>
				</Fact>
			</dl>
		</section>
	);
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
	return (
		<div className={styles.fact}>
			<dt>{term}</dt>
			<dd>{children}</dd>
		</div>
	);
}
