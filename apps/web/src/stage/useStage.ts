import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type RefObject
} from 'react';
import { sameAtlasMarkers, type AtlasMarker } from './globe/atlasMarkers';
import { sameAtlasView, type AtlasView } from './globe/atlasView';
import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import type { ResetResult } from './globe/mountainCamera';
import type { ZoomDirection, ZoomResult } from './globe/zoomStep';
import type { PresentationObserver } from './SceneSession';
import type { SceneStore, SceneSnapshot } from './SceneStore';
import { sameSceneTarget } from './sceneTarget';
import { StageBinding, type SceneFactory } from './StageBinding';

export interface UseStageOptions {
	store: SceneStore;
	ionToken: string | undefined;
	sceneFactory: SceneFactory;
	target: SceneTarget | undefined;
	atlas?: AtlasView;
	markers?: readonly AtlasMarker[];
	observer?: PresentationObserver;
}

export interface UseStageResult {
	viewportRef: RefObject<HTMLDivElement | null>;
	snapshot: SceneSnapshot;
	resetView: () => ResetResult;
	zoomView: (direction: ZoomDirection) => ZoomResult;
	toggleRotation: () => void;
	readCamera: () => CameraReading | undefined;
	retry: () => void;
}

export function useStage({
	store,
	ionToken,
	sceneFactory,
	target,
	atlas,
	markers,
	observer
}: UseStageOptions): UseStageResult {
	const viewportRef = useRef<HTMLDivElement>(null);
	const bindingRef = useRef<StageBinding | undefined>(undefined);
	const targetRef = useRef(target);
	const atlasRef = useRef(atlas);
	const markersRef = useRef(markers);
	const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

	// A new object with the same content must not restart the presentation.
	const [stableTarget, setStableTarget] = useState(target);
	if (!sameSceneTarget(stableTarget, target)) {
		setStableTarget(target);
	}

	const [stableAtlas, setStableAtlas] = useState(atlas);
	if (!sameAtlasView(stableAtlas, atlas)) {
		setStableAtlas(atlas);
	}

	// Its own path, so a catalog that changes never restarts the overview or its orbit.
	const [stableMarkers, setStableMarkers] = useState(markers);
	if (!sameAtlasMarkers(stableMarkers, markers)) {
		setStableMarkers(markers);
	}

	// Declared before the target effect so that, in one commit, the atlas a released target falls
	// back to is already known.
	useEffect(() => {
		atlasRef.current = stableAtlas;
		bindingRef.current?.setAtlas(stableAtlas);
	}, [stableAtlas]);

	useEffect(() => {
		markersRef.current = stableMarkers;
		bindingRef.current?.setAtlasMarkers(stableMarkers);
	}, [stableMarkers]);

	useEffect(() => {
		targetRef.current = stableTarget;
		bindingRef.current?.setTarget(stableTarget);
	}, [stableTarget]);

	useEffect(() => {
		const viewport = viewportRef.current;
		if (!viewport) {
			return;
		}

		const binding = new StageBinding({
			viewport,
			store,
			ionToken,
			createScene: sceneFactory({ viewport }),
			target: targetRef.current,
			atlas: atlasRef.current,
			markers: markersRef.current,
			observer
		});
		bindingRef.current = binding;

		return () => {
			binding.dispose();
			bindingRef.current = undefined;
		};
	}, [store, ionToken, sceneFactory, observer]);

	const resetView = useCallback(() => bindingRef.current?.resetView() ?? 'unavailable', []);

	const zoomView = useCallback(
		(direction: ZoomDirection) => bindingRef.current?.zoomView(direction) ?? 'unavailable',
		[]
	);

	const toggleRotation = useCallback(() => bindingRef.current?.toggleRotation(), []);

	const readCamera = useCallback(() => bindingRef.current?.readCamera(), []);

	const retry = useCallback(() => bindingRef.current?.retry(), []);

	return { viewportRef, snapshot, resetView, zoomView, toggleRotation, readCamera, retry };
}
