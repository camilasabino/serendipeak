import { ENTER_FULLSCREEN_LABEL, EXIT_FULLSCREEN_LABEL } from '../stageCopy';
import styles from './StageButton.module.css';

interface FullscreenControlProps {
	active: boolean;
	onToggle: () => void;
}

export function FullscreenControl({ active, onToggle }: FullscreenControlProps) {
	return (
		<button type="button" className={styles.button} onClick={onToggle}>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{active ? (
					<path d="M9 3.5v5.5H3.5M15 3.5v5.5h5.5M9 20.5V15H3.5M15 20.5V15h5.5" />
				) : (
					<path d="M3.5 9V3.5H9M20.5 9V3.5H15M3.5 15v5.5H9M20.5 15v5.5H15" />
				)}
			</svg>
			<span className={styles.spoken}>
				{active ? EXIT_FULLSCREEN_LABEL : ENTER_FULLSCREEN_LABEL}
			</span>
		</button>
	);
}
