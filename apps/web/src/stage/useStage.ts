import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type RefObject
} from 'react';
import type { UnitSystem } from '../units/unitSystem';
import { sameAtlasMarkers, type AtlasMarker } from './globe/atlasMarkers';
import { sameAtlasView, type AtlasView } from './globe/atlasView';
import type { SceneTarget } from './globe/camera';
import type { CameraReading } from './globe/cameraReading';
import {
	sameSightedSummits,
	type SightedSummit,
	type SummitSightings
} from './globe/summitSighting';
import type { MarkerActivation } from './globe/markerActivation';
import type { ResetResult } from './globe/mountainCamera';
import type { ZoomDirection, ZoomResult } from './globe/zoomStep';
import type { PresentationObserver } from './SceneSession';
import type { SceneStore, SceneSnapshot } from './SceneStore';
import { sameSceneTarget } from './sceneTarget';
import { StageBinding, type SceneFactory } from './StageBinding';

const NO_SUMMITS: readonly SightedSummit[] = [];

export interface UseStageOptions {
	store: SceneStore;
	ionToken: string | undefined;
	sceneFactory: SceneFactory;
	target: SceneTarget | undefined;
	atlas?: AtlasView;
	markers?: readonly AtlasMarker[];
	/** Applied without rebuilding the scene; drawn unless told otherwise. */
	summitMarkerVisible?: boolean;
	/** Followed relative to the camera without rebuilding the scene; none unless given. */
	nearbySummits?: readonly SightedSummit[];
	/** Applied to the scene without rebuilding it; the stage is metric until one is given. */
	unitSystem?: UnitSystem;
	observer?: PresentationObserver;
	/** Read when an activation arrives, so a new function never rebuilds the stage. */
	onMarkerActivate?: (activation: MarkerActivation) => void;
	/** Read when sightings arrive, so a new function never rebuilds the stage. */
	onSightings?: (sightings: SummitSightings | undefined) => void;
	onStageResize?: () => void;
}

export interface UseStageResult {
	viewportRef: RefObject<HTMLDivElement | null>;
	snapshot: SceneSnapshot;
	resetView: () => ResetResult;
	zoomView: (direction: ZoomDirection) => ZoomResult;
	toggleRotation: () => void;
	toggleMountainOrbit: () => void;
	readCamera: () => CameraReading | undefined;
	highlightMarker: (slug: string | undefined) => void;
	retry: () => void;
}

export function useStage({
	store,
	ionToken,
	sceneFactory,
	target,
	atlas,
	markers,
	summitMarkerVisible = true,
	nearbySummits = NO_SUMMITS,
	unitSystem,
	observer,
	onMarkerActivate,
	onSightings,
	onStageResize
}: UseStageOptions): UseStageResult {
	const viewportRef = useRef<HTMLDivElement>(null);
	const bindingRef = useRef<StageBinding | undefined>(undefined);
	const targetRef = useRef(target);
	const atlasRef = useRef(atlas);
	const markersRef = useRef(markers);
	const summitVisibleRef = useRef(summitMarkerVisible);
	const unitSystemRef = useRef(unitSystem);
	const activateRef = useRef(onMarkerActivate);
	const sightingsRef = useRef(onSightings);
	const resizeRef = useRef(onStageResize);
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

	const [stableNearby, setStableNearby] = useState(nearbySummits);
	if (!sameSightedSummits(stableNearby, nearbySummits)) {
		setStableNearby(nearbySummits);
	}
	const nearbyRef = useRef(stableNearby);

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
		summitVisibleRef.current = summitMarkerVisible;
		bindingRef.current?.setSummitMarkerVisible(summitMarkerVisible);
	}, [summitMarkerVisible]);

	useEffect(() => {
		unitSystemRef.current = unitSystem;
		if (unitSystem) {
			bindingRef.current?.setUnitSystem(unitSystem);
		}
	}, [unitSystem]);

	useEffect(() => {
		activateRef.current = onMarkerActivate;
		sightingsRef.current = onSightings;
		resizeRef.current = onStageResize;
	}, [onMarkerActivate, onSightings, onStageResize]);

	useEffect(() => {
		targetRef.current = stableTarget;
		bindingRef.current?.setTarget(stableTarget);
	}, [stableTarget]);

	// After the target effect, so the neighbours of the next mountain are never followed from the
	// view of the one it replaces.
	useEffect(() => {
		nearbyRef.current = stableNearby;
		bindingRef.current?.setNearbySummits(stableNearby);
	}, [stableNearby]);

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
			summitMarkerVisible: summitVisibleRef.current,
			nearbySummits: nearbyRef.current,
			unitSystem: unitSystemRef.current,
			observer,
			onMarkerActivate: (activation) => activateRef.current?.(activation),
			onSightings: (sightings) => sightingsRef.current?.(sightings),
			onStageResize: () => resizeRef.current?.()
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

	const toggleMountainOrbit = useCallback(() => bindingRef.current?.toggleMountainOrbit(), []);

	const readCamera = useCallback(() => bindingRef.current?.readCamera(), []);

	const highlightMarker = useCallback(
		(slug: string | undefined) => bindingRef.current?.highlightMarker(slug),
		[]
	);

	const retry = useCallback(() => bindingRef.current?.retry(), []);

	return {
		viewportRef,
		snapshot,
		resetView,
		zoomView,
		toggleRotation,
		toggleMountainOrbit,
		readCamera,
		highlightMarker,
		retry
	};
}
