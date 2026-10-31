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
			<svg
				className={styles.rose}
				viewBox="0 0 64 64"
				aria-hidden="true"
				style={{ transform: `rotate(${compassRoseRotationDegrees(headingDegrees)}deg)` }}
			>
				<circle className={styles.plate} cx="32" cy="32" r="30.25" />
				<path
					className={styles.ticks}
					d="M32 5.5v5.5M32 53v5.5M5.5 32H11M53 32h5.5M14.2 14.2l3.9 3.9M45.9 45.9l3.9 3.9M49.8 14.2l-3.9 3.9M18.1 45.9l-3.9 3.9"
				/>
				<path className={styles.needle} d="M32 6.4 35 15.2H29Z" />
				<text className={styles.north} x="32" y="24">
					N
				</text>
				<text className={styles.cardinal} x="49" y="35">
					E
				</text>
				<text className={styles.cardinal} x="32" y="52">
					S
				</text>
				<text className={styles.cardinal} x="15" y="35">
					W
				</text>
				<circle className={styles.pivot} cx="32" cy="32" r="1.35" />
			</svg>
			<p className={styles.readout} aria-hidden="true">
				{readout}
			</p>
		</div>
	);
}
