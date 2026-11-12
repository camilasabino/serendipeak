import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/spectral/400.css';
import type { AppProps } from 'next/app';
import Router from 'next/router';
import { useEffect, useState } from 'react';
import { createBrowserMountainApi } from '../api/browserMountainApi';
import { MountainApiProvider } from '../api/MountainApiContext';
import { AtlasReturn } from '../atlas/AtlasReturn';
import { AtlasReturnProvider } from '../atlas/AtlasReturnContext';
import { ImagePreloaderProvider } from '../media/ImagePreloaderContext';
import { ImagePreloader } from '../media/preload';
import { MountainIndexProvider } from '../mountain-index/MountainIndexContext';
import { MountainIndexStore } from '../mountain-index/MountainIndexStore';
import { AppFrame } from '../mountain-page/AppFrame';
import '../shell/tokens.css';
import { TransitionCoordinator } from '../stage/TransitionCoordinator';
import { TransitionCoordinatorProvider } from '../stage/TransitionCoordinatorContext';

// Composition root: each of these lives as long as the app, across every client navigation.
export default function App({ Component, pageProps, router }: AppProps) {
	const [api] = useState(createBrowserMountainApi);
	const [preloader] = useState(() => new ImagePreloader());
	const [coordinator] = useState(() => new TransitionCoordinator());
	const [mountainIndex] = useState(() => new MountainIndexStore({ api }));
	const [atlasReturn] = useState(() => new AtlasReturn());

	// It owns the router's pop hook, so it must listen from the first navigation on.
	useEffect(() => atlasReturn.bind(Router), [atlasReturn]);

	return (
		<MountainApiProvider value={api}>
			<ImagePreloaderProvider value={preloader}>
				<TransitionCoordinatorProvider value={coordinator}>
					<MountainIndexProvider value={mountainIndex}>
						<AtlasReturnProvider value={atlasReturn}>
							<AppFrame
								pageProps={pageProps}
								year={new Date().getUTCFullYear()}
								pathname={router.pathname}
							>
								<Component {...pageProps} />
							</AppFrame>
						</AtlasReturnProvider>
					</MountainIndexProvider>
				</TransitionCoordinatorProvider>
			</ImagePreloaderProvider>
		</MountainApiProvider>
	);
}
