import dynamic from 'next/dynamic';
import { StageChunkLoadError } from '../stage/StageBoundary';

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

export const LazyMountainScene = dynamic(() => import('../stage/MountainScene'), {
	ssr: false,
	loading: MountainSceneLoading
});
