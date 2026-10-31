import { readCesiumConfig } from '../config/readPublicConfig';
import { cesiumSceneFactory } from './cesiumSceneFactory';
import type { SceneTarget } from './globe/camera';
import styles from './MountainScene.module.css';
import type { SceneStore } from './SceneStore';
import { DETAILS_AVAILABLE_MESSAGE, FAILURE_MESSAGES } from './stageCopy';
import { useStage } from './useStage';

// Next inlines NEXT_PUBLIC_* only for literal reads, so each variable is named here.
const CESIUM_CONFIG = readCesiumConfig({
	NEXT_PUBLIC_CESIUM_ION_TOKEN: process.env.NEXT_PUBLIC_CESIUM_ION_TOKEN,
	NEXT_PUBLIC_CESIUM_IMAGERY_MODE: process.env.NEXT_PUBLIC_CESIUM_IMAGERY_MODE
});
const ION_TOKEN = CESIUM_CONFIG.ionToken ?? undefined;
const SCENE_FACTORY = cesiumSceneFactory({
	isDevelopment: process.env.NODE_ENV === 'development',
	imageryMode: CESIUM_CONFIG.imageryMode
});

interface MountainSceneProps {
	store: SceneStore;
	target: SceneTarget | undefined;
}

export default function MountainScene({ store, target }: MountainSceneProps) {
	const { stageRef, viewportRef, snapshot } = useStage({
		store,
		ionToken: ION_TOKEN,
		sceneFactory: SCENE_FACTORY,
		target
	});
	const { state } = snapshot;

	return (
		<div ref={stageRef} className={styles.scene}>
			<div ref={viewportRef} className={styles.viewport} />
			{state.status === 'failed' && (
				<div role="alert" className={styles.failure}>
					<p>{FAILURE_MESSAGES[state.failure]}</p>
					<p className={styles.hint}>{DETAILS_AVAILABLE_MESSAGE}</p>
				</div>
			)}
		</div>
	);
}
