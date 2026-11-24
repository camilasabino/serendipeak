import { useImperativeHandle, useRef, type ReactNode, type Ref } from 'react';
import { readCesiumConfig } from '../config/readPublicConfig';
import { useUnitSystem } from '../units/UnitPreferenceContext';
import { cesiumSceneFactory } from './cesiumSceneFactory';
import { sceneCanRetry } from './experience';
import type { AtlasMarker } from './globe/atlasMarkers';
import type { AtlasView } from './globe/atlasView';
import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import type { MarkerActivation } from './globe/markerActivation';
import type { ResetResult } from './globe/mountainCamera';
import { StageControls, type MarkerToggle } from './controls/StageControls';
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
	/** Emphasizes an atlas marker for as long as it is asked to, as a pointer on it would. */
	highlightMarker(slug: string | undefined): void;
}

interface MountainSceneProps {
	store: SceneStore;
	target: SceneTarget | undefined;
	atlas?: AtlasView;
	/** The markers drawn now; none while the reader has hidden them, and off the atlas. */
	markers?: readonly AtlasMarker[];
	/** Given on the atlas only, drawn or not: the switch stays while the markers are away. */
	markerToggle?: MarkerToggle;
	observer: PresentationObserver;
	controllerRef?: Ref<StageController>;
	onMarkerActivate?: (activation: MarkerActivation) => void;
	/** The stage changed shape, so a point on the globe no longer marks the same place. */
	onStageResize?: () => void;
	/** Laid over the globe inside the stage, so it stays with the globe in fullscreen. */
	children?: ReactNode;
}

export default function MountainScene({
	store,
	target,
	atlas,
	markers,
	markerToggle,
	observer,
	controllerRef,
	onMarkerActivate,
	onStageResize,
	children
}: MountainSceneProps) {
	const unitSystem = useUnitSystem();
	const {
		viewportRef,
		snapshot,
		resetView,
		zoomView,
		toggleRotation,
		readCamera,
		highlightMarker,
		retry
	} = useStage({
		store,
		ionToken: ION_TOKEN,
		sceneFactory: SCENE_FACTORY,
		target,
		atlas,
		markers,
		unitSystem,
		observer,
		onMarkerActivate,
		onStageResize
	});
	useImperativeHandle(controllerRef, () => ({ readCamera, resetView, highlightMarker }), [
		readCamera,
		resetView,
		highlightMarker
	]);
	const stageRef = useRef<HTMLDivElement>(null);
	const fullscreen = useStageFullscreen(stageRef);
	const { state } = snapshot;

	return (
		<div
			ref={stageRef}
			className={styles.scene}
			// The page's stage anchor lies outside the fullscreen element and cannot hold focus there,
			// so a surface closing inside fullscreen hands focus to this element instead.
			tabIndex={fullscreen.active ? -1 : undefined}
		>
			<div ref={viewportRef} className={styles.viewport} />
			<StageControls
				snapshot={snapshot}
				onReset={resetView}
				onZoom={zoomView}
				onToggleRotation={toggleRotation}
				fullscreen={fullscreen}
				markerToggle={markerToggle}
			/>
			{children}
			<SceneStatus state={state} onRetry={sceneCanRetry(state) ? retry : undefined} />
		</div>
	);
}
