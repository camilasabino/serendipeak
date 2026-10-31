import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/spectral/400.css';
import type { AppProps } from 'next/app';
import { useState } from 'react';
import { createBrowserMountainApi } from '../api/browserMountainApi';
import { MountainApiProvider } from '../api/MountainApiContext';
import { ImagePreloaderProvider } from '../media/ImagePreloaderContext';
import { ImagePreloader } from '../media/preload';
import { AppFrame } from '../mountain-page/AppFrame';
import '../shell/tokens.css';
import { TransitionCoordinator } from '../stage/TransitionCoordinator';
import { TransitionCoordinatorProvider } from '../stage/TransitionCoordinatorContext';

// Composition root: each of these lives as long as the app, across every client navigation.
export default function App({ Component, pageProps }: AppProps) {
	const [api] = useState(createBrowserMountainApi);
	const [preloader] = useState(() => new ImagePreloader());
	const [coordinator] = useState(() => new TransitionCoordinator());

	return (
		<MountainApiProvider value={api}>
			<ImagePreloaderProvider value={preloader}>
				<TransitionCoordinatorProvider value={coordinator}>
					<AppFrame pageProps={pageProps} year={new Date().getUTCFullYear()}>
						<Component {...pageProps} />
					</AppFrame>
				</TransitionCoordinatorProvider>
			</ImagePreloaderProvider>
		</MountainApiProvider>
	);
}
