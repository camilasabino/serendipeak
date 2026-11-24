import type { MountainOrbitState } from '../SceneStore';
import {
	PAUSE_MOUNTAIN_ORBIT_LABEL,
	RESUME_MOUNTAIN_ORBIT_LABEL,
	START_MOUNTAIN_ORBIT_LABEL
} from '../stageCopy';
import styles from './StageButton.module.css';

interface MountainOrbitControlProps {
	state: Exclude<MountainOrbitState, 'off'>;
	onToggle: () => void;
}

const LABELS: Record<MountainOrbitControlProps['state'], string> = {
	unavailable: START_MOUNTAIN_ORBIT_LABEL,
	idle: START_MOUNTAIN_ORBIT_LABEL,
	orbiting: PAUSE_MOUNTAIN_ORBIT_LABEL,
	paused: RESUME_MOUNTAIN_ORBIT_LABEL
};

// The ring passes behind the summit, so the glyph reads as a path around one mountain rather than
// the atlas's turning arrow or Reset's crosshair. Like the other toggles, the label names the
// action, and while orbiting the glyph is the plain pause the atlas rotation also uses: the two
// never share a toolbar, and a ring around pause bars reads as a power switch.
export function MountainOrbitControl({ state, onToggle }: MountainOrbitControlProps) {
	const orbiting = state === 'orbiting';

	return (
		<button
			type="button"
			className={styles.button}
			disabled={state === 'unavailable'}
			onClick={onToggle}
		>
			<svg viewBox="0 0 24 24" aria-hidden="true">
				{orbiting ? (
					<path d="M9 6v12M15 6v12" />
				) : (
					<>
						<path d="M17.5 12.2A10 4 0 1 1 6.5 12.2" />
						<path d="M7.5 15 12 5l4.5 10" />
						<path d="M4.2 11 6.5 12.2 5 14.3" />
					</>
				)}
			</svg>
			<span className={styles.spoken}>{LABELS[state]}</span>
		</button>
	);
}
