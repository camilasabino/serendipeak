import type { ZoomDirection } from '../globe/zoomStep';
import {
	TOOLTIP_UNAVAILABLE,
	ZOOM_GROUP_LABEL,
	ZOOM_IN_LABEL,
	ZOOM_IN_TOOLTIP,
	ZOOM_OUT_LABEL,
	ZOOM_OUT_TOOLTIP
} from '../stageCopy';
import styles from './StageButton.module.css';
import { Tooltip } from './Tooltip';

interface ZoomControlsProps {
	enabled: boolean;
	onZoom: (direction: ZoomDirection) => void;
}

export function ZoomControls({ enabled, onZoom }: ZoomControlsProps) {
	return (
		<div role="group" aria-label={ZOOM_GROUP_LABEL} className={styles.group} data-stage-obstacle="">
			<Tooltip text={enabled ? ZOOM_IN_TOOLTIP : TOOLTIP_UNAVAILABLE} side="end">
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
			</Tooltip>
			<Tooltip text={enabled ? ZOOM_OUT_TOOLTIP : TOOLTIP_UNAVAILABLE} side="end">
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
			</Tooltip>
		</div>
	);
}
