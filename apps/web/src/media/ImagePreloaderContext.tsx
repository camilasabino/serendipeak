import { createContext, useContext } from 'react';
import type { ImagePreloader } from './preload';

const ImagePreloaderContext = createContext<ImagePreloader | undefined>(undefined);

export const ImagePreloaderProvider = ImagePreloaderContext.Provider;

export function useImagePreloader(): ImagePreloader {
	const preloader = useContext(ImagePreloaderContext);
	if (!preloader) {
		throw new Error('ImagePreloaderProvider is missing above this component.');
	}

	return preloader;
}
