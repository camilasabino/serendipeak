import { RESET_VIEW_LABEL, RESET_VIEW_TOOLTIP, TOOLTIP_UNAVAILABLE } from '../stageCopy';
import styles from './StageButton.module.css';
import { Tooltip } from './Tooltip';

interface ResetControlProps {
	enabled: boolean;
	onReset: () => void;
}

export function ResetControl({ enabled, onReset }: ResetControlProps) {
	return (
		<Tooltip text={enabled ? RESET_VIEW_TOOLTIP : TOOLTIP_UNAVAILABLE} side="start">
			<button type="button" className={styles.button} disabled={!enabled} onClick={onReset}>
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<circle cx="12" cy="12" r="5" />
					<path d="M12 2.5v4M12 17.5v4M2.5 12h4M17.5 12h4" />
				</svg>
				<span className={styles.spoken}>{RESET_VIEW_LABEL}</span>
			</button>
		</Tooltip>
	);
}
