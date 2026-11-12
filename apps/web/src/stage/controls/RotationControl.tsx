import { PAUSE_ROTATION_LABEL, RESUME_ROTATION_LABEL } from '../stageCopy';
import styles from './StageButton.module.css';

interface RotationControlProps {
	rotating: boolean;
	onToggle: () => void;
}

// The pause the ambient orbit needs as motion that starts by itself and keeps going.
export function RotationControl({ rotating, onToggle }: RotationControlProps) {
	return (
		<button type="button" className={styles.button} onClick={onToggle}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{rotating ? (
					<path d="M9 6v12M15 6v12" />
				) : (
					<>
						<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
						<path d="M19.5 3.5v4h-4" />
					</>
				)}
			</svg>
			<span className={styles.spoken}>
				{rotating ? PAUSE_ROTATION_LABEL : RESUME_ROTATION_LABEL}
			</span>
		</button>
	);
}
