import { Fragment, type CSSProperties } from 'react';
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
	/** Fades the rings in, then runs a bright trace around each one, only while the user allows motion. */
	reveal?: boolean;
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
	reveal = false,
	className
}: ContourMotifProps) {
	const base = reveal ? `${styles.motif} ${styles.reveal}` : styles.motif;
	const classes = className ? `${base} ${className}` : base;

	return (
		<svg
			className={classes}
			viewBox={`0 0 ${pattern.width} ${pattern.height}`}
			preserveAspectRatio={align === 'center' ? 'xMidYMid slice' : 'xMaxYMin slice'}
			aria-hidden="true"
			focusable="false"
		>
			{pattern.rings.map(({ d, index }, position) => {
				const ring = { '--ring': pattern.rings.length - 1 - position } as CSSProperties;

				return (
					<Fragment key={d}>
						<path
							d={d}
							className={level === 'index' && index ? styles.index : undefined}
							style={reveal ? ring : undefined}
						/>
						{reveal && <path d={d} pathLength={1} className={styles.trace} style={ring} />}
					</Fragment>
				);
			})}
		</svg>
	);
}
