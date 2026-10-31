import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { MountainImage } from '../api/contract';
import { pageRatio } from './aspect';
import { useImagePreloader } from './ImagePreloaderContext';
import { PhotoReveal, type PhotoSnapshot } from './PhotoReveal';
import { isPhotoHidden } from './primaryPhoto';
import { pageRendition } from './renditions';

const SERVER_SNAPSHOT: PhotoSnapshot = { source: undefined, status: 'pending' };

// The image being rendered is the authority: a snapshot only counts for the source it was measured on.
export function usePhotoReveal(image: MountainImage) {
	const preloader = useImagePreloader();
	const [reveal] = useState(() => new PhotoReveal(preloader));
	const snapshot = useSyncExternalStore(
		reveal.subscribe,
		reveal.getSnapshot,
		() => SERVER_SNAPSHOT
	);
	const { src, srcset, sizes } = pageRendition(image);
	const rendition = useMemo(() => ({ src, srcset, sizes }), [src, srcset, sizes]);
	const imageRef = useRef<HTMLImageElement | null>(null);

	const bind = useCallback(
		(node: HTMLImageElement | null) => {
			if (!node) {
				return;
			}

			imageRef.current = node;
			const detach = reveal.attach(node, rendition);

			return () => {
				detach();
				imageRef.current = null;
			};
		},
		[reveal, rendition]
	);

	const failedSource = snapshot.status === 'failed' ? snapshot.source : undefined;
	const settledHere = snapshot.source === rendition.src;
	const measured = settledHere && snapshot.status === 'ready' ? snapshot.dimensions : undefined;
	const known = measured ?? preloader.dimensionsOf(rendition);

	return {
		rendition,
		imageRef,
		bind,
		hidden: isPhotoHidden(failedSource, rendition.src),
		ready: settledHere && snapshot.status === 'ready',
		ratio: pageRatio(image, known ? known.width / known.height : undefined)
	};
}
