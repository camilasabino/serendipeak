import {
	compassRoseRotationDegrees,
	compassSpokenLabel,
	formatBearing
} from '../globe/orientation';
import styles from './Compass.module.css';

interface CompassProps {
	headingDegrees: number | undefined;
}

export function Compass({ headingDegrees }: CompassProps) {
	if (headingDegrees === undefined) {
		return null;
	}

	const readout = formatBearing(headingDegrees);
	const spoken = compassSpokenLabel(headingDegrees);
	if (readout === undefined || spoken === undefined) {
		return null;
	}

	return (
		<div className={styles.compass}>
			<p className={styles.spoken}>{spoken}</p>
			<span className={styles.dial}>
				<svg
					className={styles.rose}
					viewBox="0 0 40 40"
					aria-hidden="true"
					style={{ transform: `rotate(${compassRoseRotationDegrees(headingDegrees)}deg)` }}
				>
					<path className={styles.ticks} d="M20 6v4M20 30v4M6 20h4M30 20h4" />
					<path className={styles.north} d="M20 9l3 11h-6z" />
					<path className={styles.south} d="M20 31l3-11h-6z" />
				</svg>
			</span>
			<p className={styles.readout} aria-hidden="true">
				{readout}
			</p>
		</div>
	);
}
