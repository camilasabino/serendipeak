import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { SceneStore } from '../stage/SceneStore';
import styles from './MountainLayout.module.css';
import { mountainOf, type MountainModel } from './pageModel';
import { toSceneTarget } from './sceneTarget';
import { StageShell } from './StageShell';

const MountainScene = dynamic(() => import('../stage/MountainScene'), { ssr: false });

interface MountainLayoutProps {
	model: MountainModel;
	children: ReactNode;
}

export function MountainLayout({ model, children }: MountainLayoutProps) {
	const [store] = useState(() => new SceneStore());

	return (
		<main className={styles.mountain}>
			{children}
			<StageShell store={store} daily={model.kind === 'daily'} className={styles.stage}>
				<MountainScene store={store} target={toSceneTarget(mountainOf(model))} />
			</StageShell>
		</main>
	);
}
