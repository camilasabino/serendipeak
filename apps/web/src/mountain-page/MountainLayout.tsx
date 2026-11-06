import { useState, type ReactNode } from 'react';
import { SceneStore } from '../stage/SceneStore';
import { StageBoundary } from '../stage/StageBoundary';
import { useTransitionCoordinator } from '../stage/TransitionCoordinatorContext';
import { LazyMountainScene } from './LazyMountainScene';
import styles from './MountainLayout.module.css';
import { mountainOf, type MountainModel } from './pageModel';
import { toSceneTarget } from './sceneTarget';
import { StageShell } from './StageShell';

interface MountainLayoutProps {
	model: MountainModel;
	children: ReactNode;
}

export function MountainLayout({ model, children }: MountainLayoutProps) {
	const [store] = useState(() => new SceneStore());
	const coordinator = useTransitionCoordinator();

	return (
		<main className={styles.mountain}>
			{children}
			<StageShell store={store} daily={model.kind === 'daily'} className={styles.stage}>
				<StageBoundary store={store}>
					<LazyMountainScene
						store={store}
						target={toSceneTarget(mountainOf(model))}
						observer={coordinator}
					/>
				</StageBoundary>
			</StageShell>
		</main>
	);
}
