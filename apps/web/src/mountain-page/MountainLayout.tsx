import dynamic from 'next/dynamic';
import { useState, type ReactNode } from 'react';
import { SceneStore } from '../stage/SceneStore';
import { StageBoundary, StageChunkLoadError } from '../stage/StageBoundary';
import styles from './MountainLayout.module.css';
import { mountainOf, type MountainModel } from './pageModel';
import { toSceneTarget } from './sceneTarget';
import { StageShell } from './StageShell';

interface LoadingProps {
	error?: Error | null;
	retry?: () => void;
}

// Hands a failed chunk to the stage boundary; otherwise the SSR loader would stay up forever.
function MountainSceneLoading({ error, retry }: LoadingProps) {
	if (error) {
		throw new StageChunkLoadError(error, retry);
	}

	return null;
}

const MountainScene = dynamic(() => import('../stage/MountainScene'), {
	ssr: false,
	loading: MountainSceneLoading
});

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
				<StageBoundary store={store}>
					<MountainScene store={store} target={toSceneTarget(mountainOf(model))} />
				</StageBoundary>
			</StageShell>
		</main>
	);
}
