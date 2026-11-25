import {
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
	type FocusEvent,
	type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import {
	CLOSE_NAVIGATION_HELP_LABEL,
	GUIDE_TAB_LABELS,
	GUIDE_TABS,
	NAVIGATION_HELP_LABEL,
	NAVIGATION_HELP_TOOLTIP,
	navigationGuide,
	type GuideTab,
	type NavigationHelpContext
} from '../stageCopy';
import { GuideIcon } from './GuideIcon';
import buttonStyles from './StageButton.module.css';
import styles from './NavigationHelp.module.css';
import { Tooltip } from './Tooltip';

const COARSE_POINTER_QUERY = '(pointer: coarse)';

// A non-modal popover: it never traps focus or blocks the globe, and any interaction elsewhere
// dismisses it so it cannot linger over the mountain.
export function NavigationHelp({
	context,
	onOpenChange
}: {
	context: NavigationHelpContext;
	/** Tells the stage while the panel is open, so nothing else is drawn over it. */
	onOpenChange?: (open: boolean) => void;
}) {
	const [open, setOpen] = useState(false);
	const [tab, setTab] = useState<GuideTab>('mouse');
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const panelRef = useRef<HTMLElement>(null);
	const panelId = useId();
	const titleId = useId();
	const tabsId = useId();
	const tabRefs = useRef<Partial<Record<GuideTab, HTMLButtonElement | null>>>({});
	const guide = navigationGuide(context);

	const close = useCallback((restoreFocus: boolean) => {
		setOpen(false);
		if (restoreFocus) {
			triggerRef.current?.focus();
		}
	}, []);

	useEffect(() => {
		onOpenChange?.(open);

		return () => onOpenChange?.(false);
	}, [open, onOpenChange]);

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
		setTab(window.matchMedia(COARSE_POINTER_QUERY).matches ? 'touch' : 'mouse');
		setOpen(true);
	};

	const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		const index = GUIDE_TABS.indexOf(tab);
		const next =
			event.key === 'ArrowRight'
				? (index + 1) % GUIDE_TABS.length
				: event.key === 'ArrowLeft'
					? (index + GUIDE_TABS.length - 1) % GUIDE_TABS.length
					: event.key === 'Home'
						? 0
						: event.key === 'End'
							? GUIDE_TABS.length - 1
							: undefined;
		if (next === undefined) {
			return;
		}
		event.preventDefault();
		const target = GUIDE_TABS[next]!;
		setTab(target);
		tabRefs.current[target]?.focus();
	};

	const onBlur = (event: FocusEvent<HTMLDivElement>) => {
		const next = event.relatedTarget;
		if (next instanceof Node && !event.currentTarget.contains(next)) {
			close(false);
		}
	};

	return (
		<div ref={rootRef} onBlur={onBlur}>
			<Tooltip text={NAVIGATION_HELP_TOOLTIP} side="end">
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
			</Tooltip>
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
				<div role="tablist" aria-label="Guide sections" className={styles.tabs}>
					{GUIDE_TABS.map((name) => (
						<button
							key={name}
							ref={(element) => {
								tabRefs.current[name] = element;
							}}
							type="button"
							role="tab"
							id={`${tabsId}-tab-${name}`}
							aria-selected={tab === name}
							aria-controls={`${tabsId}-panel-${name}`}
							tabIndex={tab === name ? 0 : -1}
							className={styles.tab}
							onClick={() => setTab(name)}
							onKeyDown={onTabKeyDown}
						>
							{GUIDE_TAB_LABELS[name]}
						</button>
					))}
				</div>
				{GUIDE_TABS.map((name) => (
					<div
						key={name}
						role="tabpanel"
						id={`${tabsId}-panel-${name}`}
						aria-labelledby={`${tabsId}-tab-${name}`}
						hidden={tab !== name}
						tabIndex={0}
						className={styles.tabpanel}
					>
						<ul className={styles.rows}>
							{guide[name].rows.map(({ icon, action, description }) => (
								<li key={action} className={styles.row}>
									<GuideIcon name={icon} className={styles.icon} />
									<span>
										<strong className={styles.action}>{action}</strong>{' '}
										<span className={styles.description}>{description}</span>
									</span>
								</li>
							))}
						</ul>
						{guide[name].note && <p className={styles.note}>{guide[name].note}</p>}
					</div>
				))}
			</section>
		</div>
	);
}
