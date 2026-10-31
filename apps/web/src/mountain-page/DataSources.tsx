import type { MountainSources } from '../api/contract';
import { ExternalLink } from '../links/ExternalLink';
import { Disclosure } from './Disclosure';
import styles from './DataSources.module.css';

export function DataSources({ sources }: { sources: MountainSources | undefined }) {
	const entries = [
		{ label: '© OpenStreetMap contributors', href: sources?.osm },
		{ label: 'Wikidata', href: sources?.wikidata }
	].filter((entry): entry is { label: string; href: string } => entry.href !== undefined);

	if (entries.length === 0) {
		return null;
	}

	return (
		<div className={styles.sources}>
			<Disclosure summary="Data sources">
				<ul>
					{entries.map(({ label, href }) => (
						<li key={label}>
							<ExternalLink href={href}>{label}</ExternalLink>
						</li>
					))}
				</ul>
			</Disclosure>
		</div>
	);
}
