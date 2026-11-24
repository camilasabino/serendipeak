import type { ZoomDirection } from '../globe/zoomStep';
import type { SceneSnapshot } from '../SceneStore';
import { stageControlsFor } from '../stageControls';
import type { StageFullscreen } from '../useStageFullscreen';
import { Compass } from './Compass';
import { FullscreenControl } from './FullscreenControl';
import { MarkerVisibilityControl } from './MarkerVisibilityControl';
import { MountainOrbitControl } from './MountainOrbitControl';
import { NavigationHelp } from './NavigationHelp';
import { ResetControl } from './ResetControl';
import { RotationControl } from './RotationControl';
import { ScaleBar } from './ScaleBar';
import styles from './StageControls.module.css';
import { ZoomControls } from './ZoomControls';

/** The reader's switch for the atlas markers; present only where the globe carries them. */
export interface MarkerToggle {
	shown: boolean;
	onToggle: () => void;
}

interface StageControlsProps {
	snapshot: SceneSnapshot;
	onReset: () => void;
	onZoom: (direction: ZoomDirection) => void;
	onToggleRotation: () => void;
	/** Given where the stage offers the orbit around its mountain. */
	onToggleMountainOrbit?: () => void;
	fullscreen: StageFullscreen;
	/** The globe carries atlas markers, which the help then explains and this switches. */
	markerToggle?: MarkerToggle;
}

export function StageControls({
	snapshot,
	onReset,
	onZoom,
	onToggleRotation,
	onToggleMountainOrbit,
	fullscreen,
	markerToggle
}: StageControlsProps) {
	const { state, headingDegrees, scale, rotation, mountainOrbit } = snapshot;
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
				<NavigationHelp
					markers={markerToggle !== undefined}
					markersHidden={markerToggle?.shown === false}
				/>
			</div>
			<div className={styles.toolbar}>
				<ResetControl enabled={controls.resetEnabled} onReset={onReset} />
				{rotation !== 'off' && (
					<RotationControl rotating={rotation === 'rotating'} onToggle={onToggleRotation} />
				)}
				{onToggleMountainOrbit && mountainOrbit !== 'off' && (
					<MountainOrbitControl state={mountainOrbit} onToggle={onToggleMountainOrbit} />
				)}
				{markerToggle && (
					<MarkerVisibilityControl shown={markerToggle.shown} onToggle={markerToggle.onToggle} />
				)}
				{fullscreen.supported && (
					<FullscreenControl active={fullscreen.active} onToggle={fullscreen.toggle} />
				)}
			</div>
		</>
	);
}
