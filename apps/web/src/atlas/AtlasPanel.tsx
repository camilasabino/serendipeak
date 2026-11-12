import { useEffect, useMemo } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { useMountainIndex } from '../mountain-index/MountainIndexContext';
import { ATLAS_HEADING, atlasLede } from './atlasCopy';
import { AtlasList } from './AtlasList';
import styles from './AtlasPanel.module.css';
import { groupByContinent } from './groupByContinent';

export const ATLAS_HEADING_ID = 'atlas-heading';

/** The atlas sheet: the catalog by continent, beside the globe the layout shows in overview. */
export function AtlasPanel({ mountains }: { mountains: MountainIndexEntry[] }) {
	const indexStore = useMountainIndex();
	const groups = useMemo(() => groupByContinent(mountains), [mountains]);

	useEffect(() => {
		indexStore.seed(mountains);
	}, [indexStore, mountains]);

	return (
		<div className={styles.sheet}>
			<h1 id={ATLAS_HEADING_ID} tabIndex={-1} className={styles.title}>
				{ATLAS_HEADING}
			</h1>
			<p className={styles.lede}>{atlasLede(mountains.length)}</p>
			{groups.length > 0 && <AtlasList groups={groups} />}
		</div>
	);
}
