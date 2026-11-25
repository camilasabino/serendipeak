import {
	createContext,
	useContext,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
	type FocusEvent,
	type PointerEvent,
	type ReactNode
} from 'react';
import { intersectBoxes, tooltipShift } from './tooltipShift';
import styles from './Tooltip.module.css';

/** While true no tooltip shows, so none can lie over a panel the reader has opened. */
const TooltipSuppression = createContext(false);

export const TooltipSuppressionProvider = TooltipSuppression.Provider;

export type TooltipSide = 'start' | 'end';

interface TooltipProps {
	/** What pressing the button does now; the button keeps its own accessible name. */
	text: string;
	/** Where the tooltip opens: `end` toward the right, `start` toward the left. */
	side: TooltipSide;
	children: ReactNode;
}

// The tooltip is a visual aid only. It stays out of the accessibility tree so a screen reader
// hears the button's name once, and it is rendered outside the button so it never joins that name.
// Touch never opens it: a tap activates the button, and a tooltip that needs hover has no touch
// equivalent. A mouse or pen pointer shows it on entry, a keyboard focus ring shows it on focus.
export function Tooltip({ text, side, children }: TooltipProps) {
	const suppressed = useContext(TooltipSuppression);
	const [hovered, setHovered] = useState(false);
	const [focused, setFocused] = useState(false);
	const [dismissed, setDismissed] = useState(false);
	const anchorRef = useRef<HTMLSpanElement>(null);
	const tooltipRef = useRef<HTMLSpanElement>(null);
	const visible = (hovered || focused) && !dismissed && !suppressed;

	useEffect(() => {
		if (!visible) {
			return;
		}
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				setDismissed(true);
			}
		};
		document.addEventListener('keydown', onKeyDown);

		return () => document.removeEventListener('keydown', onKeyDown);
	}, [visible]);

	// Measured before paint, so a tooltip near an edge never shows in the wrong place first.
	useLayoutEffect(() => {
		const tooltip = tooltipRef.current;
		if (!visible || !tooltip) {
			return;
		}
		tooltip.style.setProperty('--tooltip-shift-x', '0px');
		tooltip.style.setProperty('--tooltip-shift-y', '0px');
		const stage = anchorRef.current?.closest<HTMLElement>('[data-stage]');
		const viewport = { left: 0, top: 0, right: innerWidth, bottom: innerHeight };
		const bounds = stage ? intersectBoxes(stage.getBoundingClientRect(), viewport) : viewport;
		const shift = tooltipShift(tooltip.getBoundingClientRect(), bounds);
		tooltip.style.setProperty('--tooltip-shift-x', `${shift.x}px`);
		tooltip.style.setProperty('--tooltip-shift-y', `${shift.y}px`);
	}, [visible, text]);

	const onPointerEnter = (event: PointerEvent) => {
		if (event.pointerType === 'touch') {
			return;
		}
		setDismissed(false);
		setHovered(true);
	};

	const onFocus = (event: FocusEvent) => {
		if (!event.target.matches(':focus-visible')) {
			return;
		}
		setDismissed(false);
		setFocused(true);
	};

	return (
		<span
			ref={anchorRef}
			className={styles.anchor}
			onPointerEnter={onPointerEnter}
			onPointerLeave={() => setHovered(false)}
			onFocus={onFocus}
			onBlur={() => setFocused(false)}
		>
			{children}
			<span
				ref={tooltipRef}
				aria-hidden="true"
				className={styles.tooltip}
				data-side={side}
				data-visible={visible}
			>
				{text}
			</span>
		</span>
	);
}
