import type { ReactNode } from 'react';
import type { GuideIcon as GuideIconName } from '../stageCopy';

// Gesture drawings are new; the control glyphs repeat the buttons' own, so the guide shows what the
// reader will see on the stage.
const GLYPHS: Record<GuideIconName, ReactNode> = {
	move: <path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />,
	scroll: (
		<>
			<rect x="7" y="3" width="10" height="18" rx="5" />
			<path d="M12 7v3" />
		</>
	),
	'tilt-rotate': (
		<>
			<ellipse cx="12" cy="13" rx="9" ry="4" />
			<path d="M12 3v6M9.5 5.5 12 3l2.5 2.5" />
		</>
	),
	open: (
		<>
			<path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" />
			<circle cx="12" cy="11" r="2.1" />
		</>
	),
	'drag-one': (
		<>
			<circle cx="6" cy="12" r="2.5" />
			<path d="M10.5 12H20M17 9l3 3-3 3" />
		</>
	),
	pinch: (
		<>
			<circle cx="6" cy="18" r="2" />
			<circle cx="18" cy="6" r="2" />
			<path d="M9.5 14.5l5-5M9.5 14.5v-3M9.5 14.5h3M14.5 9.5v3M14.5 9.5h-3" />
		</>
	),
	'drag-two': (
		<>
			<circle cx="8" cy="18" r="2" />
			<circle cx="16" cy="18" r="2" />
			<path d="M8 14V4M5 7l3-3 3 3M16 14V4M13 7l3-3 3 3" />
		</>
	),
	twist: (
		<>
			<circle cx="7" cy="18" r="2" />
			<circle cx="17" cy="18" r="2" />
			<path d="M7 12a8 8 0 0 1 10 0M17 7.5V12h-4.5" />
		</>
	),
	zoom: <path d="M12 5v14M5 12h14" />,
	reset: (
		<>
			<circle cx="12" cy="12" r="5" />
			<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
		</>
	),
	rotation: (
		<>
			<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
			<path d="M19.5 3.5v4h-4" />
		</>
	),
	markers: (
		<>
			<path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" />
			<circle cx="12" cy="11" r="2.1" />
		</>
	),
	orbit: (
		<>
			<path d="M17.5 12.2A10 4 0 1 1 6.5 12.2" />
			<path d="M7.5 15 12 5l4.5 10" />
			<path d="M4.2 11 6.5 12.2 5 14.3" />
		</>
	),
	fullscreen: <path d="M3.5 9V3.5H9M20.5 9V3.5H15M3.5 15v5.5H9M20.5 15v5.5H15" />
};

export function GuideIcon({ name, className }: { name: GuideIconName; className?: string }) {
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true" className={className}>
			{GLYPHS[name]}
		</svg>
	);
}
