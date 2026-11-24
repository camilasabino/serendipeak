import Router from 'next/router';
import {
	useEffect,
	useId,
	useRef,
	useState,
	type MouseEvent as ReactMouseEvent,
	type ReactNode
} from 'react';
import { bindRouteChanges } from '../explore/navigate';
import styles from './SiteHeader.module.css';

const MENU_LABEL = 'Menu';

interface HeaderMenuProps {
	children: ReactNode;
}

/**
 * The header's destinations and settings. The header's own width decides how they are shown: laid
 * out in the row when it fits, otherwise behind a disclosure button. A disclosure and not an ARIA
 * menu: its content is ordinary links and buttons, so Tab moves through it and nothing is trapped.
 */
export function HeaderMenu({ children }: HeaderMenuProps) {
	const panelId = useId();
	const [open, setOpen] = useState(false);
	const toggleRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		if (!open) {
			return;
		}

		const close = () => setOpen(false);
		const inside = (target: EventTarget | null) =>
			target instanceof Node &&
			Boolean(toggleRef.current?.contains(target) || panelRef.current?.contains(target));
		const onPointerDown = (event: PointerEvent) => {
			if (!inside(event.target)) {
				close();
			}
		};
		const onFocusIn = (event: FocusEvent) => {
			if (!inside(event.target)) {
				close();
			}
		};
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				close();
				toggleRef.current?.focus();
			}
		};

		// Widening the header shows the links in the row; the menu must not still count as open when
		// it narrows again. The width is read when the menu opens, because the observer's first report
		// can already include a resize that happened in between.
		const header = toggleRef.current?.closest('header');
		const openedAt = header?.clientWidth;
		const observer = new ResizeObserver(() => {
			if (header && header.clientWidth !== openedAt) {
				close();
			}
		});
		if (header) {
			observer.observe(header);
		}

		document.addEventListener('pointerdown', onPointerDown);
		document.addEventListener('focusin', onFocusIn);
		document.addEventListener('keydown', onKeyDown);
		const unbind = bindRouteChanges(Router.events, close);

		return () => {
			observer.disconnect();
			document.removeEventListener('pointerdown', onPointerDown);
			document.removeEventListener('focusin', onFocusIn);
			document.removeEventListener('keydown', onKeyDown);
			unbind();
		};
	}, [open]);

	// The link that was activated is about to be hidden, so focus goes back to the button rather
	// than to the document.
	const onPanelClick = (event: ReactMouseEvent) => {
		if (event.target instanceof Element && event.target.closest('a')) {
			setOpen(false);
			toggleRef.current?.focus();
		}
	};

	return (
		<>
			<button
				ref={toggleRef}
				type="button"
				className={styles.toggle}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={() => setOpen((current) => !current)}
			>
				<svg className={styles.toggleIcon} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
					{open ? <path d="m4.5 4.5 11 11m0-11-11 11" /> : <path d="M3 5.5h14M3 10h14M3 14.5h14" />}
				</svg>
				<span>{MENU_LABEL}</span>
			</button>
			<div
				ref={panelRef}
				id={panelId}
				className={styles.panel}
				data-open={open || undefined}
				onClick={onPanelClick}
			>
				{children}
			</div>
		</>
	);
}
