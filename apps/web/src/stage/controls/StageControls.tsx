import { useMemo, useState } from 'react';
import type { ZoomDirection } from '../globe/zoomStep';
import type { SceneSnapshot } from '../SceneStore';
import { stageControlsFor } from '../stageControls';
import type { NavigationHelpContext } from '../stageCopy';
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
import { TooltipSuppressionProvider } from './Tooltip';
import { ZoomControls } from './ZoomControls';

// Each control group carries `data-stage-obstacle`, so surfaces laid over the stage keep clear of it.

/** The reader's switch for the markers the globe draws, which the help explains and this controls. */
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
	markerToggle?: MarkerToggle;
	/** The stage presents the atlas, not a mountain; decides what the help describes. */
	onAtlas?: boolean;
}

export function StageControls({
	snapshot,
	onReset,
	onZoom,
	onToggleRotation,
	onToggleMountainOrbit,
	fullscreen,
	markerToggle,
	onAtlas = false
}: StageControlsProps) {
	const [helpOpen, setHelpOpen] = useState(false);
	const { state, headingDegrees, scale, rotation, mountainOrbit } = snapshot;
	const controls = stageControlsFor(state, snapshot);
	const orbit = onToggleMountainOrbit !== undefined && mountainOrbit !== 'off';
	const helpContext = useMemo<NavigationHelpContext>(() => {
		const markersHidden = markerToggle ? !markerToggle.shown : undefined;
		return onAtlas
			? {
					kind: 'atlas',
					markersHidden,
					rotation: rotation !== 'off',
					fullscreen: fullscreen.supported
				}
			: { kind: 'mountain', markersHidden, orbit, fullscreen: fullscreen.supported };
	}, [onAtlas, markerToggle, rotation, orbit, fullscreen.supported]);
	if (!controls.visible) {
		return null;
	}

	return (
		<TooltipSuppressionProvider value={helpOpen}>
			<Compass headingDegrees={headingDegrees} />
			<ScaleBar reading={scale} />
			<div className={styles.navigation}>
				<ZoomControls enabled={controls.zoomEnabled} onZoom={onZoom} />
				<NavigationHelp context={helpContext} onOpenChange={setHelpOpen} />
			</div>
			<div className={styles.toolbar} data-stage-obstacle="">
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
		</TooltipSuppressionProvider>
	);
}
