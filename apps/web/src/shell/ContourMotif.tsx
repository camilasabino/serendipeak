import styles from './ContourMotif.module.css';

export interface ContourRing {
	d: string;
	/** Heavier line that marks every fourth contour, like an index contour on a map. */
	index: boolean;
}

export interface ContourPattern {
	width: number;
	height: number;
	rings: readonly ContourRing[];
}

interface ContourMotifProps {
	pattern: ContourPattern;
	/** `quiet` draws every ring alike; `index` also draws the heavier index contours. */
	level?: 'quiet' | 'index';
	className?: string;
}

/**
 * Decorative brand graphic, never terrain data. It anchors to the upper right and crops from the
 * left and bottom, so the summit rings stay in view when the box is narrow. Whoever places it sizes
 * and masks it so it stays clear of text.
 */
export function ContourMotif({ pattern, level = 'quiet', className }: ContourMotifProps) {
	const classes = className ? `${styles.motif} ${className}` : styles.motif;

	return (
		<svg
			className={classes}
			viewBox={`0 0 ${pattern.width} ${pattern.height}`}
			preserveAspectRatio="xMaxYMin slice"
			aria-hidden="true"
			focusable="false"
		>
			{pattern.rings.map(({ d, index }) => (
				<path key={d} d={d} className={level === 'index' && index ? styles.index : undefined} />
			))}
		</svg>
	);
}
