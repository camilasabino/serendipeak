import type { ReactNode } from 'react';
import { MountainApiProvider } from '../api/MountainApiContext';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { ImagePreloaderProvider } from '../media/ImagePreloaderContext';
import { ImagePreloader } from '../media/preload';
import { MountainIndexProvider } from '../mountain-index/MountainIndexContext';
import { MountainIndexStore } from '../mountain-index/MountainIndexStore';
import { TransitionCoordinator } from '../stage/TransitionCoordinator';
import { TransitionCoordinatorProvider } from '../stage/TransitionCoordinatorContext';

export function TestExperience({ children }: { children: ReactNode }) {
	const api = new FakeMountainApi();

	return (
		<MountainApiProvider value={api}>
			<ImagePreloaderProvider value={new ImagePreloader({ create: () => undefined })}>
				<TransitionCoordinatorProvider value={new TransitionCoordinator()}>
					<MountainIndexProvider value={new MountainIndexStore({ api })}>
						{children}
					</MountainIndexProvider>
				</TransitionCoordinatorProvider>
			</ImagePreloaderProvider>
		</MountainApiProvider>
	);
}
