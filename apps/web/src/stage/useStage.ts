import {
	useCallback,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
	type RefObject
} from 'react';
import type { SceneTarget } from './globe/camera';
import type { ResetResult } from './globe/mountainCamera';
import type { SceneStore, SceneSnapshot } from './SceneStore';
import { sameSceneTarget } from './sceneTarget';
import { StageBinding, type SceneFactory } from './StageBinding';

export interface UseStageOptions {
	store: SceneStore;
	ionToken: string | undefined;
	sceneFactory: SceneFactory;
	target: SceneTarget | undefined;
}

export interface UseStageResult {
	viewportRef: RefObject<HTMLDivElement | null>;
	snapshot: SceneSnapshot;
	resetView: () => ResetResult;
}

export function useStage({
	store,
	ionToken,
	sceneFactory,
	target
}: UseStageOptions): UseStageResult {
	const viewportRef = useRef<HTMLDivElement>(null);
	const bindingRef = useRef<StageBinding | undefined>(undefined);
	const targetRef = useRef(target);
	const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);

	// A new object with the same content must not restart the presentation.
	const [stableTarget, setStableTarget] = useState(target);
	if (!sameSceneTarget(stableTarget, target)) {
		setStableTarget(target);
	}

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
			target: targetRef.current
		});
		bindingRef.current = binding;

		return () => {
			binding.dispose();
			bindingRef.current = undefined;
		};
	}, [store, ionToken, sceneFactory]);

	const resetView = useCallback(() => bindingRef.current?.resetView() ?? 'unavailable', []);

	return { viewportRef, snapshot, resetView };
}
