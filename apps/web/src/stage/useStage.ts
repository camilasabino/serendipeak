import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from 'react';
import type { SceneTarget } from './globe/camera';
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
	stageRef: RefObject<HTMLDivElement | null>;
	viewportRef: RefObject<HTMLDivElement | null>;
	snapshot: SceneSnapshot;
}

export function useStage({
	store,
	ionToken,
	sceneFactory,
	target
}: UseStageOptions): UseStageResult {
	const stageRef = useRef<HTMLDivElement>(null);
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
		const stage = stageRef.current;
		const viewport = viewportRef.current;
		if (!stage || !viewport) {
			return;
		}

		const binding = new StageBinding({
			viewport,
			store,
			ionToken,
			createScene: sceneFactory({ stage, viewport }),
			target: targetRef.current
		});
		bindingRef.current = binding;

		return () => {
			binding.dispose();
			bindingRef.current = undefined;
		};
	}, [store, ionToken, sceneFactory]);

	return { stageRef, viewportRef, snapshot };
}
