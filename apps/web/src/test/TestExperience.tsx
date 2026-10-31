import type { ReactNode } from 'react';
import { MountainApiProvider } from '../api/MountainApiContext';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { ImagePreloaderProvider } from '../media/ImagePreloaderContext';
import { ImagePreloader } from '../media/preload';
import { TransitionCoordinator } from '../stage/TransitionCoordinator';
import { TransitionCoordinatorProvider } from '../stage/TransitionCoordinatorContext';

export function TestExperience({ children }: { children: ReactNode }) {
	return (
		<MountainApiProvider value={new FakeMountainApi()}>
			<ImagePreloaderProvider value={new ImagePreloader({ create: () => undefined })}>
				<TransitionCoordinatorProvider value={new TransitionCoordinator()}>
					{children}
				</TransitionCoordinatorProvider>
			</ImagePreloaderProvider>
		</MountainApiProvider>
	);
}
