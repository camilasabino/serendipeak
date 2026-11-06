import {
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type MouseEvent,
	type SyntheticEvent
} from 'react';
import type { MountainImage } from '../api/contract';
import { intrinsicRatio, pageRatio } from './aspect';
import { watchImage } from './imageReadiness';
import { PhotoCredit } from './PhotoCredit';
import styles from './PhotoViewer.module.css';
import { photoAlt } from './primaryPhoto';
import { intrinsicDimensions, pageRendition, viewerTarget, type ViewerTarget } from './renditions';

export interface ViewerStart {
	src: string;
	width: number;
	height: number;
}

interface PhotoViewerProps {
	image: MountainImage;
	mountainName: string;
	initial?: ViewerStart;
	onClose: () => void;
}

function upgradeFor(
	image: MountainImage,
	start: string,
	initial: ViewerStart | undefined,
	ratio: number | undefined
): ViewerTarget | undefined {
	if (typeof window === 'undefined') {
		return undefined;
	}

	return viewerTarget(
		image,
		{ src: start, width: initial?.width ?? 0 },
		{
			width: window.innerWidth,
			height: window.innerHeight,
			devicePixelRatio: window.devicePixelRatio
		},
		ratio
	);
}

export function PhotoViewer({ image, mountainName, initial, onClose }: PhotoViewerProps) {
	const dialog = useRef<HTMLDialogElement>(null);
	const closeButton = useRef<HTMLButtonElement>(null);
	const [upgraded, setUpgraded] = useState<ViewerTarget>();

	const alt = photoAlt(mountainName);
	const start = initial?.src ?? pageRendition(image).src;
	const observed =
		initial && initial.width > 0 && initial.height > 0 ? initial.width / initial.height : undefined;
	const ratio =
		intrinsicRatio(image) === undefined && observed === undefined
			? undefined
			: pageRatio(image, observed);
	const [target] = useState(() => upgradeFor(image, start, initial, ratio));
	const fitWidth = target?.width ?? initial?.width ?? intrinsicDimensions(image)?.width;
	const sized = ratio !== undefined && fitWidth !== undefined;

	// Layout effect: the lock and the focus return must settle in the same commit that removes the dialog.
	useLayoutEffect(() => {
		const node = dialog.current;
		if (!node) {
			return;
		}

		const opener = document.activeElement;
		const root = document.documentElement;
		const overflow = root.style.overflow;

		node.showModal();
		closeButton.current?.focus();
		root.style.overflow = 'hidden';

		return () => {
			root.style.overflow = overflow;
			if (node.open) {
				node.close();
			}
			if (opener instanceof HTMLElement && opener.isConnected) {
				opener.focus();
			}
		};
	}, []);

	useEffect(() => {
		if (!target) {
			return;
		}

		const probe = new Image();
		probe.src = target.src;

		return watchImage(probe, (outcome) => {
			if (outcome.status === 'ready') {
				setUpgraded(target);
			}
		});
	}, [target]);

	// Strict Mode reopens the dialog right after closing it; only a dialog that stayed closed ends the viewer.
	function onDialogClose(event: SyntheticEvent<HTMLDialogElement>) {
		if (!event.currentTarget.open) {
			onClose();
		}
	}

	function onBackdropClick(event: MouseEvent<HTMLDialogElement>) {
		const clicked = event.target;

		if (clicked instanceof Element && !clicked.closest('img, button, a, [data-viewer-caption]')) {
			onClose();
		}
	}

	return (
		<dialog
			ref={dialog}
			className={styles.viewer}
			aria-modal="true"
			aria-label={alt}
			onClose={onDialogClose}
			onClick={onBackdropClick}
		>
			<button type="button" className={styles.close} ref={closeButton} onClick={onClose}>
				<span className={styles.label}>Close</span>
				<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
					<path
						d="M3.2 3.2 L12.8 12.8 M12.8 3.2 L3.2 12.8"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.5"
					/>
				</svg>
			</button>
			<div className={styles.sheet}>
				{/* eslint-disable-next-line @next/next/no-img-element -- remote photograph chosen by viewerTarget */}
				<img
					className={styles.image}
					src={upgraded?.src ?? start}
					alt={alt}
					decoding="async"
					style={
						sized
							? {
									aspectRatio: ratio,
									width: `min(calc(100vw - 2.5rem), calc(var(--available-height) * ${ratio}), ${fitWidth}px)`
								}
							: undefined
					}
				/>
				<p className={styles.caption} data-viewer-caption="">
					<PhotoCredit image={image} />
				</p>
			</div>
		</dialog>
	);
}
