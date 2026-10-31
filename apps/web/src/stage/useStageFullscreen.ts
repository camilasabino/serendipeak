import { useCallback, useSyncExternalStore, type RefObject } from 'react';
import {
	fullscreenSupported,
	isStageFullscreen,
	subscribeFullscreenChange,
	toggleFullscreen
} from './fullscreen';

export interface StageFullscreen {
	supported: boolean;
	active: boolean;
	toggle: () => void;
}

const subscribeNothing = () => () => {};
const subscribeToDocument = (onChange: () => void) => subscribeFullscreenChange(document, onChange);
const supportedNow = () => fullscreenSupported(document);
const never = () => false;

export function useStageFullscreen(stageRef: RefObject<HTMLElement | null>): StageFullscreen {
	const supported = useSyncExternalStore(subscribeNothing, supportedNow, never);
	const active = useSyncExternalStore(
		subscribeToDocument,
		() => isStageFullscreen(document, stageRef.current),
		never
	);
	const toggle = useCallback(() => {
		const stage = stageRef.current;
		if (stage) {
			void toggleFullscreen(document, stage);
		}
	}, [stageRef]);

	return { supported, active, toggle };
}
