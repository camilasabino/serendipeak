import type { CSSProperties } from 'react';
import { scaleSpecForStage, WRAPPED_CREDITS_STAGE_PX, type ScaleReading } from '../globe/scaleBar';
import styles from './ScaleBar.module.css';

const BAR_HEIGHT_PX = 8;
const WIDE = scaleSpecForStage(WRAPPED_CREDITS_STAGE_PX);
const NARROW = scaleSpecForStage(WRAPPED_CREDITS_STAGE_PX - 1);

// The view is sampled at these offsets, so the bar must be drawn at the same place.
const PLACEMENT = {
	'--scale-inset': `${WIDE.insetPx}px`,
	'--scale-bottom': `${WIDE.bottomPx}px`,
	'--scale-bottom-narrow': `${NARROW.bottomPx}px`
} as CSSProperties;

interface ScaleBarProps {
	reading: ScaleReading | undefined;
}

export function ScaleBar({ reading }: ScaleBarProps) {
	if (reading === undefined) {
		return null;
	}

	const width = Math.max(2, Math.round(reading.widthPx));
	const path = `M1 1V${BAR_HEIGHT_PX - 1}H${width - 1}V1`;

	return (
		<div className={styles.scale} style={PLACEMENT}>
			<p className={styles.label}>
				<span className={styles.spoken}>Scale:</span> {reading.label}
			</p>
			<svg
				className={styles.bar}
				width={width}
				height={BAR_HEIGHT_PX}
				viewBox={`0 0 ${width} ${BAR_HEIGHT_PX}`}
				aria-hidden="true"
			>
				<path className={styles.casing} d={path} />
				<path className={styles.rule} d={path} />
			</svg>
		</div>
	);
}
