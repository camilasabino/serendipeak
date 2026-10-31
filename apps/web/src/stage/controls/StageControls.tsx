import type { SceneSnapshot } from '../SceneStore';
import { stageControlsFor } from '../stageControls';
import type { StageFullscreen } from '../useStageFullscreen';
import { Compass } from './Compass';
import { FullscreenControl } from './FullscreenControl';
import { ResetControl } from './ResetControl';
import { ScaleBar } from './ScaleBar';
import styles from './StageControls.module.css';

interface StageControlsProps {
	snapshot: SceneSnapshot;
	onReset: () => void;
	fullscreen: StageFullscreen;
}

export function StageControls({ snapshot, onReset, fullscreen }: StageControlsProps) {
	const { state, headingDegrees, scale, settled } = snapshot;
	const controls = stageControlsFor(state, settled);
	if (!controls.visible) {
		return null;
	}

	return (
		<>
			<Compass headingDegrees={headingDegrees} />
			<ScaleBar reading={scale} />
			<div className={styles.toolbar}>
				<ResetControl enabled={controls.resetEnabled} onReset={onReset} />
				{fullscreen.supported && (
					<FullscreenControl active={fullscreen.active} onToggle={fullscreen.toggle} />
				)}
			</div>
		</>
	);
}
