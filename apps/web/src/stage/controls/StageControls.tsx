import type { ZoomDirection } from '../globe/zoomStep';
import type { SceneSnapshot } from '../SceneStore';
import { stageControlsFor } from '../stageControls';
import type { StageFullscreen } from '../useStageFullscreen';
import { Compass } from './Compass';
import { FullscreenControl } from './FullscreenControl';
import { NavigationHelp } from './NavigationHelp';
import { ResetControl } from './ResetControl';
import { RotationControl } from './RotationControl';
import { ScaleBar } from './ScaleBar';
import styles from './StageControls.module.css';
import { ZoomControls } from './ZoomControls';

interface StageControlsProps {
	snapshot: SceneSnapshot;
	onReset: () => void;
	onZoom: (direction: ZoomDirection) => void;
	onToggleRotation: () => void;
	fullscreen: StageFullscreen;
}

export function StageControls({
	snapshot,
	onReset,
	onZoom,
	onToggleRotation,
	fullscreen
}: StageControlsProps) {
	const { state, headingDegrees, scale, rotation } = snapshot;
	const controls = stageControlsFor(state, snapshot);
	if (!controls.visible) {
		return null;
	}

	return (
		<>
			<Compass headingDegrees={headingDegrees} />
			<ScaleBar reading={scale} />
			<div className={styles.navigation}>
				<ZoomControls enabled={controls.zoomEnabled} onZoom={onZoom} />
				<NavigationHelp />
			</div>
			<div className={styles.toolbar}>
				<ResetControl enabled={controls.resetEnabled} onReset={onReset} />
				{rotation !== 'off' && (
					<RotationControl rotating={rotation === 'rotating'} onToggle={onToggleRotation} />
				)}
				{fullscreen.supported && (
					<FullscreenControl active={fullscreen.active} onToggle={fullscreen.toggle} />
				)}
			</div>
		</>
	);
}
