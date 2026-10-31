import Link from 'next/link';
import { ExploreControl } from '../explore/ExploreControl';
import styles from './MountainNavigation.module.css';
import { TODAY_LINK_LABEL } from './pageCopy';
import { mountainOf, type MountainModel } from './pageModel';

export function MountainNavigation({ model }: { model: MountainModel }) {
	return (
		<>
			{model.kind === 'mountain' && (
				<Link className={styles.today} href="/">
					{TODAY_LINK_LABEL}
				</Link>
			)}
			<ExploreControl slug={mountainOf(model).slug} />
		</>
	);
}
