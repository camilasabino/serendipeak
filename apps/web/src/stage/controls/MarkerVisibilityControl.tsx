import {
	HIDE_MARKERS_LABEL,
	HIDE_MARKERS_TOOLTIP,
	SHOW_MARKERS_LABEL,
	SHOW_MARKERS_TOOLTIP
} from '../stageCopy';
import styles from './StageButton.module.css';
import { Tooltip } from './Tooltip';

interface MarkerVisibilityControlProps {
	shown: boolean;
	onToggle: () => void;
}

// The label names the action and flips with the state, as the rotation and fullscreen controls do,
// so no pressed state is exposed on top of it. The glyph shows the state instead: a pin that is
// struck through says why the globe is bare.
export function MarkerVisibilityControl({ shown, onToggle }: MarkerVisibilityControlProps) {
	return (
		<Tooltip text={shown ? HIDE_MARKERS_TOOLTIP : SHOW_MARKERS_TOOLTIP} side="start">
			<button type="button" className={styles.button} onClick={onToggle}>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10z" />
					<circle cx="12" cy="11" r="2.1" />
					{!shown && <path d="M4 4l16 16" />}
				</svg>
				<span className={styles.spoken}>{shown ? HIDE_MARKERS_LABEL : SHOW_MARKERS_LABEL}</span>
			</button>
		</Tooltip>
	);
}
