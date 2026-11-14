import Link from 'next/link';
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
	type FocusEvent
} from 'react';
import { mountainHref } from '../explore/navigate';
import { formatElevation } from '../formatElevation';
import { scaleSpecForStage } from '../stage/globe/scaleBar';
import { CLOSE_MARKER_CHOOSER_LABEL, MARKER_CHOOSER_TITLE } from './atlasCopy';
import { isIntentionalClick } from './chooserClick';
import { inChooserOrder } from './chooserOrder';
import { placeChooser, type ChooserPlacement } from './chooserPlacement';
import styles from './MarkerChooser.module.css';
import type { MarkerChoice } from './useMarkerActivation';

interface MarkerChooserProps {
	choice: MarkerChoice;
	onClose: () => void;
}

/**
 * The mountains a press on the globe could have meant, as plain links to their pages, listed by
 * name with their elevations, beside the point pressed and inside the stage: a list longer than
 * the room scrolls under a header that keeps the close button in view. Non-modal like the navigation help: it takes focus so the keyboard and screen
 * readers find it, and any press, wheel or focus elsewhere, or Escape, dismisses it. Its owner
 * dismisses it when the stage changes shape, which the stage already observes.
 */
export function MarkerChooser({ choice, onClose }: MarkerChooserProps) {
	const rootRef = useRef<HTMLDivElement>(null);
	const optionsRef = useRef<HTMLUListElement>(null);
	const firstRef = useRef<HTMLAnchorElement>(null);
	const titleId = useId();
	const pressBeganInside = useRef(false);
	const [position, setPosition] = useState<ChooserPlacement | undefined>(undefined);
	const mountains = useMemo(() => inChooserOrder(choice.mountains), [choice.mountains]);

	// Dismissed from inside, focus goes back to the stage it was opened on rather than the page:
	// to the fullscreen element while that is showing, since the page's stage lies outside it.
	const close = useCallback(
		(restoreFocus: boolean) => {
			const root = rootRef.current;
			if (restoreFocus && root) {
				const fullscreen = document.fullscreenElement;
				const anchor =
					fullscreen instanceof HTMLElement && fullscreen.contains(root)
						? fullscreen
						: root.closest<HTMLElement>('[data-stage]');
				anchor?.focus({ preventScroll: true });
			}
			onClose();
		},
		[onClose]
	);

	useLayoutEffect(() => {
		const root = rootRef.current;
		const options = optionsRef.current;
		const stage = root?.offsetParent;
		if (!root || !options || !(stage instanceof HTMLElement)) {
			return;
		}
		// What the list would take if nothing cut it short, whatever height it was last given: the
		// chrome around the list plus the whole of the list, scrolled out of view or not.
		const height = root.offsetHeight - options.clientHeight + options.scrollHeight;
		setPosition(
			placeChooser(
				choice.at,
				{ width: root.offsetWidth, height },
				{ width: stage.clientWidth, height: stage.clientHeight },
				scaleSpecForStage(stage.clientWidth).bottomPx
			)
		);
	}, [choice]);

	// Only once placed: until then it is hidden, and a hidden link cannot take focus.
	useEffect(() => {
		if (position) {
			firstRef.current?.focus({ preventScroll: true });
		}
	}, [position]);

	useEffect(() => {
		const outside = (event: Event) =>
			!(event.target instanceof Node) || !rootRef.current?.contains(event.target);
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				close(rootRef.current?.contains(document.activeElement) ?? false);
			}
		};
		const onPointerDown = (event: PointerEvent) => {
			if (outside(event)) {
				close(false);
			} else {
				pressBeganInside.current = true;
			}
		};
		const onWheel = (event: WheelEvent) => {
			if (outside(event)) {
				close(false);
			}
		};
		const options = { capture: true, passive: true } as const;
		document.addEventListener('keydown', onKeyDown);
		document.addEventListener('pointerdown', onPointerDown, options);
		document.addEventListener('wheel', onWheel, options);

		return () => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('pointerdown', onPointerDown, options);
			document.removeEventListener('wheel', onWheel, options);
		};
	}, [close]);

	const onBlur = (event: FocusEvent<HTMLDivElement>) => {
		const next = event.relatedTarget;
		if (next instanceof Node && !event.currentTarget.contains(next)) {
			close(false);
		}
	};

	return (
		<div
			ref={rootRef}
			role="dialog"
			aria-labelledby={titleId}
			className={styles.chooser}
			style={
				position
					? { left: position.x, top: position.y, maxHeight: position.maxHeight }
					: { left: choice.at.x, top: choice.at.y, visibility: 'hidden' }
			}
			onBlur={onBlur}
			data-marker-chooser=""
		>
			<div className={styles.header}>
				<p id={titleId} className={styles.title}>
					{MARKER_CHOOSER_TITLE}
				</p>
				<button
					type="button"
					className={styles.close}
					aria-label={CLOSE_MARKER_CHOOSER_LABEL}
					onClick={() => close(true)}
				>
					<svg viewBox="0 0 24 24" aria-hidden="true">
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				</button>
			</div>
			<ul ref={optionsRef} className={styles.options}>
				{mountains.map((mountain, index) => (
					<li key={mountain.slug}>
						<Link
							ref={index === 0 ? firstRef : undefined}
							href={mountainHref(mountain.slug)}
							prefetch={false}
							className={styles.option}
							onClick={(event) => {
								const intentional = isIntentionalClick(event, pressBeganInside.current);
								pressBeganInside.current = false;
								if (!intentional) {
									event.preventDefault();
								}
							}}
						>
							<span className={styles.name}>{mountain.name}</span>
							{/* A flex container drops the space from the layout but not from the link's
							    accessible name, which would otherwise run the two together. */}{' '}
							<span className={styles.elevation}>{formatElevation(mountain.elevationMeters)}</span>
						</Link>
					</li>
				))}
			</ul>
		</div>
	);
}
