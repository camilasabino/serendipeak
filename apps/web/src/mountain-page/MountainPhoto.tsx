import { useState } from 'react';
import type { MountainImage } from '../api/contract';
import { PhotoCredit } from '../media/PhotoCredit';
import { PhotoViewer, type ViewerStart } from '../media/PhotoViewer';
import { photoAlt } from '../media/primaryPhoto';
import { usePhotoReveal } from '../media/usePhotoReveal';
import { Disclosure } from './Disclosure';
import styles from './MountainPhoto.module.css';

interface OpenViewer {
	source: string;
	start: ViewerStart;
}

export function MountainPhoto({
	image,
	mountainName
}: {
	image: MountainImage;
	mountainName: string;
}) {
	const { rendition, imageRef, bind, hidden, ready, ratio } = usePhotoReveal(image);
	const [viewing, setViewing] = useState<OpenViewer>();

	if (viewing && viewing.source !== rendition.src) {
		setViewing(undefined);
	}

	if (hidden) {
		return null;
	}

	function openViewer() {
		const node = imageRef.current;

		if (!ready || !node?.currentSrc) {
			return;
		}

		setViewing({
			source: rendition.src,
			start: { src: node.currentSrc, width: node.naturalWidth, height: node.naturalHeight }
		});
	}

	return (
		<figure className={styles.photo}>
			<div
				className={styles.frame}
				style={{ aspectRatio: ratio }}
				data-state={ready ? 'ready' : 'pending'}
			>
				{/* eslint-disable-next-line @next/next/no-img-element -- remote photograph, sized by the contract */}
				<img
					key={rendition.src}
					ref={bind}
					src={rendition.src}
					alt={photoAlt(mountainName)}
					loading="eager"
					decoding="async"
				/>
				<button type="button" className={styles.open} disabled={!ready} onClick={openViewer}>
					<span className={styles.label}>View photo fullscreen</span>
					<svg
						className={styles.mark}
						viewBox="0 0 16 16"
						width="16"
						height="16"
						aria-hidden="true"
					>
						<path
							d="M3 6.2 V3.2 H6.2 M9.8 3.2 H13 V6.2 M13 9.8 V13 H9.8 M6.2 13 H3 V9.8"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.5"
						/>
					</svg>
				</button>
			</div>
			{viewing && (
				<PhotoViewer
					image={image}
					mountainName={mountainName}
					initial={viewing.start}
					onClose={() => setViewing(undefined)}
				/>
			)}
			<figcaption>
				<Disclosure summary="About this photo">
					<p>
						<PhotoCredit image={image} />
					</p>
				</Disclosure>
			</figcaption>
		</figure>
	);
}
