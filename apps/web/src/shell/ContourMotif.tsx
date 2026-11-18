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
	/** `summit` anchors the upper right; `center` keeps a pattern drawn around its middle centred. */
	align?: 'summit' | 'center';
	/** Draws the rings in and back out on a loop, only while the user allows motion. */
	draw?: boolean;
	className?: string;
}

/**
 * Decorative brand graphic, never terrain data. By default it anchors to the upper right and crops
 * from the left and bottom, so the summit rings stay in view when the box is narrow. Whoever places
 * it sizes and masks it so it stays clear of text.
 */
export function ContourMotif({
	pattern,
	level = 'quiet',
	align = 'summit',
	draw = false,
	className
}: ContourMotifProps) {
	const base = draw ? `${styles.motif} ${styles.draw}` : styles.motif;
	const classes = className ? `${base} ${className}` : base;

	return (
		<svg
			className={classes}
			viewBox={`0 0 ${pattern.width} ${pattern.height}`}
			preserveAspectRatio={align === 'center' ? 'xMidYMid slice' : 'xMaxYMin slice'}
			aria-hidden="true"
			focusable="false"
		>
			{pattern.rings.map(({ d, index }) => (
				<path
					key={d}
					d={d}
					pathLength={draw ? 1 : undefined}
					className={level === 'index' && index ? styles.index : undefined}
				/>
			))}
		</svg>
	);
}
