import { useImperativeHandle, useRef, type Ref } from 'react';
import { readCesiumConfig } from '../config/readPublicConfig';
import { cesiumSceneFactory } from './cesiumSceneFactory';
import { sceneCanRetry } from './experience';
import type { AtlasView } from './globe/atlasView';
import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import type { ResetResult } from './globe/mountainCamera';
import { StageControls } from './controls/StageControls';
import styles from './MountainScene.module.css';
import type { PresentationObserver } from './SceneSession';
import type { SceneStore } from './SceneStore';
import { SceneStatus } from './SceneStatus';
import { useStage } from './useStage';
import { useStageFullscreen } from './useStageFullscreen';

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

/** What a surface laid over the stage may ask of the scene, without owning it. */
export interface StageController {
	readCamera(): CameraReading | undefined;
	resetView(): ResetResult;
}

interface MountainSceneProps {
	store: SceneStore;
	target: SceneTarget | undefined;
	atlas?: AtlasView;
	observer: PresentationObserver;
	controllerRef?: Ref<StageController>;
}

export default function MountainScene({
	store,
	target,
	atlas,
	observer,
	controllerRef
}: MountainSceneProps) {
	const { viewportRef, snapshot, resetView, zoomView, toggleRotation, readCamera, retry } =
		useStage({
			store,
			ionToken: ION_TOKEN,
			sceneFactory: SCENE_FACTORY,
			target,
			atlas,
			observer
		});
	useImperativeHandle(controllerRef, () => ({ readCamera, resetView }), [readCamera, resetView]);
	const stageRef = useRef<HTMLDivElement>(null);
	const fullscreen = useStageFullscreen(stageRef);
	const { state } = snapshot;

	return (
		<div ref={stageRef} className={styles.scene}>
			<div ref={viewportRef} className={styles.viewport} />
			<StageControls
				snapshot={snapshot}
				onReset={resetView}
				onZoom={zoomView}
				onToggleRotation={toggleRotation}
				fullscreen={fullscreen}
			/>
			<SceneStatus state={state} onRetry={sceneCanRetry(state) ? retry : undefined} />
		</div>
	);
}
