import { useCallback, useEffect, useId, useRef, useState, type FocusEvent } from 'react';
import {
	BUTTON_NAVIGATION,
	CLOSE_NAVIGATION_HELP_LABEL,
	MARKER_NAVIGATION,
	NAVIGATION_HELP_LABEL,
	POINTER_NAVIGATION,
	TOUCH_NAVIGATION,
	type NavigationHelpSection
} from '../stageCopy';
import buttonStyles from './StageButton.module.css';
import styles from './NavigationHelp.module.css';

const COARSE_POINTER_QUERY = '(pointer: coarse)';

export function navigationHelpSections(
	touchFirst: boolean,
	markers = false
): readonly NavigationHelpSection[] {
	const gestures = touchFirst
		? [TOUCH_NAVIGATION, POINTER_NAVIGATION, BUTTON_NAVIGATION]
		: [POINTER_NAVIGATION, TOUCH_NAVIGATION, BUTTON_NAVIGATION];

	return markers ? [MARKER_NAVIGATION, ...gestures] : gestures;
}

// A non-modal popover: it never traps focus or blocks the globe, and any interaction elsewhere
// dismisses it so it cannot linger over the mountain.
export function NavigationHelp({ markers = false }: { markers?: boolean }) {
	const [open, setOpen] = useState(false);
	const [touchFirst, setTouchFirst] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLElement>(null);
	const panelId = useId();
	const titleId = useId();

	const close = useCallback((restoreFocus: boolean) => {
		setOpen(false);
		if (restoreFocus) {
			triggerRef.current?.focus();
		}
	}, []);

	useEffect(() => {
		if (!open) {
			return;
		}
		panelRef.current?.focus();

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') {
				return;
			}
			close(rootRef.current?.contains(document.activeElement) ?? false);
		};
		const onPointerDown = (event: PointerEvent) => {
			if (!(event.target instanceof Node) || !rootRef.current?.contains(event.target)) {
				close(false);
			}
		};
		document.addEventListener('keydown', onKeyDown);
		document.addEventListener('pointerdown', onPointerDown);

		return () => {
			document.removeEventListener('keydown', onKeyDown);
			document.removeEventListener('pointerdown', onPointerDown);
		};
	}, [open, close]);

	const toggle = () => {
		if (open) {
			close(false);
			return;
		}
		setTouchFirst(window.matchMedia(COARSE_POINTER_QUERY).matches);
		setOpen(true);
	};

	const onBlur = (event: FocusEvent<HTMLDivElement>) => {
		const next = event.relatedTarget;
		if (next instanceof Node && !event.currentTarget.contains(next)) {
			close(false);
		}
	};

	return (
		<div ref={rootRef} onBlur={onBlur}>
			<button
				ref={triggerRef}
				type="button"
				className={buttonStyles.button}
				aria-expanded={open}
				aria-controls={panelId}
				onClick={toggle}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="9" />
					<path d="M9.6 9.4a2.5 2.5 0 1 1 3.6 2.3c-.8.4-1.2 1-1.2 1.8v.5" />
					<path d="M12 17.3v.2" />
				</svg>
				<span className={buttonStyles.spoken}>{NAVIGATION_HELP_LABEL}</span>
			</button>
			<section
				ref={panelRef}
				id={panelId}
				role="dialog"
				aria-labelledby={titleId}
				tabIndex={-1}
				hidden={!open}
				className={styles.panel}
			>
				<div className={styles.header}>
					<h2 id={titleId} className={styles.title}>
						{NAVIGATION_HELP_LABEL}
					</h2>
					<button type="button" className={styles.close} onClick={() => close(true)}>
						<svg viewBox="0 0 24 24" aria-hidden="true">
							<path d="M6 6l12 12M18 6L6 18" />
						</svg>
						<span className={buttonStyles.spoken}>{CLOSE_NAVIGATION_HELP_LABEL}</span>
					</button>
				</div>
				{navigationHelpSections(touchFirst, markers).map(({ heading, gestures }) => (
					<div key={heading} className={styles.section}>
						<h3 className={styles.heading}>{heading}</h3>
						<dl className={styles.gestures}>
							{gestures.map(({ action, gesture }) => (
								<div key={action} className={styles.gesture}>
									<dt>{action}</dt>
									<dd>{gesture}</dd>
								</div>
							))}
						</dl>
					</div>
				))}
			</section>
		</div>
	);
}
