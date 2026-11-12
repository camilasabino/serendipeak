import { ExploreControl } from '../explore/ExploreControl';
import styles from './MountainNavigation.module.css';
import { mountainOf, type MountainModel } from './pageModel';

export function MountainNavigation({ model }: { model: MountainModel }) {
	return (
		<span className={styles.explore}>
			<ExploreControl slug={mountainOf(model).slug} />
		</span>
	);
}
