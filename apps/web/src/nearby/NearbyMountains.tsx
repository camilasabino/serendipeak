import Link from 'next/link';
import { useId } from 'react';
import { mountainHref } from '../explore/navigate';
import { formatElevation } from '../formatElevation';
import { useUnitSystem } from '../units/UnitPreferenceContext';
import type { UnitSystem } from '../units/unitSystem';
import { describeDistance } from './formatDistance';
import type { NearbyMountain } from './findNearbyMountains';
import styles from './NearbyMountains.module.css';

export const NEARBY_HEADING = 'Nearby mountains';

interface NearbyMountainsProps {
	mountains: readonly NearbyMountain[];
}

/**
 * The closest mountains in a straight line, as plain links to their pages. It renders nothing
 * without any, so a catalog too sparse to have neighbours leaves no empty heading. The links are in
 * the server-rendered document, and the figures follow the visitor's unit system.
 */
export function NearbyMountains({ mountains }: NearbyMountainsProps) {
	const headingId = useId();
	const system = useUnitSystem();

	if (mountains.length === 0) {
		return null;
	}

	return (
		<section aria-labelledby={headingId} className={styles.nearby}>
			<h2 id={headingId} className={styles.heading}>
				{NEARBY_HEADING}
			</h2>
			<ul className={styles.list}>
				{mountains.map((mountain) => {
					const distance = describeDistance(mountain.distanceKm, system);

					return (
						<li key={mountain.slug}>
							<Link href={mountainHref(mountain.slug)} prefetch={false} className={styles.link}>
								<span className={styles.text}>
									<span className={styles.name}>{mountain.name}</span>
									<span className={styles.detail}>{detailOf(mountain, system)}</span>
								</span>
								<span className={styles.distance}>
									<span aria-hidden="true">{`≈ ${distance.value} ${distance.unit}`}</span>
									<span className={styles.hidden}>{`${distance.spoken} away`}</span>
								</span>
							</Link>
						</li>
					);
				})}
			</ul>
		</section>
	);
}

function detailOf({ place, elevationMeters }: NearbyMountain, system: UnitSystem): string {
	return `${place} · ${formatElevation(elevationMeters, system)}`;
}
