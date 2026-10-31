import Link from 'next/link';
import { ExplorePlaceholder } from '../shell/ExplorePlaceholder';
import styles from './MountainNavigation.module.css';
import { TODAY_LINK_LABEL } from './pageCopy';
import type { MountainModel } from './pageModel';

export function MountainNavigation({ model }: { model: MountainModel }) {
	return (
		<>
			{model.kind === 'mountain' && (
				<Link className={styles.today} href="/">
					{TODAY_LINK_LABEL}
				</Link>
			)}
			<ExplorePlaceholder />
		</>
	);
}
