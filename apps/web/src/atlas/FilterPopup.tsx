import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import styles from './FilterPopup.module.css';

const GAP = 4;
const MARGIN = 8;
const MAX_HEIGHT = 352;
const MAX_WIDTH = 448;

interface FilterPopupProps {
	id: string;
	/** The control that opened it: the popup sits against it and clicks on it are not outside. */
	anchor: RefObject<HTMLElement | null>;
	/** Asked when the reader leaves the popup; `restoreFocus` is set when they did so by keyboard. */
	onDismiss: (restoreFocus: boolean) => void;
	className?: string;
	role?: string;
	label?: string;
	children: ReactNode;
}

/**
 * Puts the popup beside its anchor, below it unless there is more room above, and no taller than
 * the room on that side. It is positioned from the viewport, so a scrolling ancestor cannot clip it.
 */
function place(popup: HTMLElement, anchor: HTMLElement) {
	const viewport = window.visualViewport;
	const top = viewport?.offsetTop ?? 0;
	const height = viewport?.height ?? window.innerHeight;
	const left = viewport?.offsetLeft ?? 0;
	const width = viewport?.width ?? document.documentElement.clientWidth;
	const rect = anchor.getBoundingClientRect();

	const below = top + height - rect.bottom - GAP - MARGIN;
	const above = rect.top - top - GAP - MARGIN;
	popup.style.maxHeight = 'none';
	const natural = Math.min(popup.offsetHeight, MAX_HEIGHT);
	const opensBelow = below >= natural || below >= above;
	const size = Math.max(0, Math.min(natural, opensBelow ? below : above));
	const shown = Math.min(natural, size);

	const popupWidth = Math.min(rect.width, MAX_WIDTH, width - 2 * MARGIN);
	popup.style.maxHeight = `${size}px`;
	popup.style.width = `${popupWidth}px`;
	popup.style.left = `${Math.max(left + MARGIN, Math.min(rect.left, left + width - popupWidth - MARGIN))}px`;
	popup.style.top = `${opensBelow ? rect.bottom + GAP : rect.top - GAP - shown}px`;
}

/**
 * A panel in the top layer that follows an anchor and closes itself on Escape, on a press outside
 * and when focus leaves for something else. Mount it only while open: each opening then starts from
 * fresh state, and nothing of it exists in the server's markup.
 */
export function FilterPopup({
	id,
	anchor,
	onDismiss,
	className,
	role,
	label,
	children
}: FilterPopupProps) {
	const popup = useRef<HTMLDivElement>(null);
	// The latest callback, read from listeners that are attached once.
	const dismiss = useRef(onDismiss);
	useLayoutEffect(() => {
		dismiss.current = onDismiss;
	});

	// The top layer keeps it over every container; a browser without it still gets a fixed box.
	useLayoutEffect(() => {
		const element = popup.current;
		const target = anchor.current;
		if (!element || !target) {
			return;
		}
		if (typeof element.showPopover === 'function' && !element.matches(':popover-open')) {
			element.showPopover();
		}
		place(element, target);

		const reposition = (event?: Event) => {
			// The list inside scrolls on its own; only the page moving the anchor needs a new place.
			if (!(event?.target instanceof Node && element.contains(event.target))) {
				place(element, target);
			}
		};
		window.addEventListener('resize', reposition);
		window.addEventListener('scroll', reposition, true);
		window.visualViewport?.addEventListener('resize', reposition);
		window.visualViewport?.addEventListener('scroll', reposition);

		return () => {
			window.removeEventListener('resize', reposition);
			window.removeEventListener('scroll', reposition, true);
			window.visualViewport?.removeEventListener('resize', reposition);
			window.visualViewport?.removeEventListener('scroll', reposition);
			if (typeof element.hidePopover === 'function' && element.matches(':popover-open')) {
				element.hidePopover();
			}
		};
	}, [anchor]);

	useEffect(() => {
		const onPointerDown = (event: PointerEvent) => {
			const { target } = event;
			if (
				target instanceof Node &&
				!popup.current?.contains(target) &&
				!anchor.current?.contains(target)
			) {
				dismiss.current(false);
			}
		};
		// Captured, so a handler lower down cannot keep the popup open by stopping the event.
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				event.stopPropagation();
				dismiss.current(true);
			}
		};
		document.addEventListener('pointerdown', onPointerDown, true);
		document.addEventListener('keydown', onKeyDown, true);

		return () => {
			document.removeEventListener('pointerdown', onPointerDown, true);
			document.removeEventListener('keydown', onKeyDown, true);
		};
	}, [anchor]);

	return (
		<div
			ref={popup}
			id={id}
			// Light dismissal is done above, so the popup is not closed behind the component's back.
			popover="manual"
			role={role}
			aria-label={label}
			className={`${styles.popup} ${className ?? ''}`}
			onBlur={(event) => {
				const next = event.relatedTarget;
				if (
					next instanceof Node &&
					!event.currentTarget.contains(next) &&
					next !== anchor.current
				) {
					dismiss.current(false);
				}
			}}
		>
			{children}
		</div>
	);
}
