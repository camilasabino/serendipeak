import type { ZoomDirection } from '../globe/zoomStep';
import { ZOOM_GROUP_LABEL, ZOOM_IN_LABEL, ZOOM_OUT_LABEL } from '../stageCopy';
import styles from './StageButton.module.css';

interface ZoomControlsProps {
	enabled: boolean;
	onZoom: (direction: ZoomDirection) => void;
}

export function ZoomControls({ enabled, onZoom }: ZoomControlsProps) {
	return (
		<div role="group" aria-label={ZOOM_GROUP_LABEL} className={styles.group}>
			<button
				type="button"
				className={styles.button}
				disabled={!enabled}
				onClick={() => onZoom('in')}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 5v14M5 12h14" />
				</svg>
				<span className={styles.spoken}>{ZOOM_IN_LABEL}</span>
			</button>
			<button
				type="button"
				className={styles.button}
				disabled={!enabled}
				onClick={() => onZoom('out')}
			>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M5 12h14" />
				</svg>
				<span className={styles.spoken}>{ZOOM_OUT_LABEL}</span>
			</button>
		</div>
	);
}
