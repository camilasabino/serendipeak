import { useMemo, useRef, useState, type ReactNode } from 'react';
import type { MountainIndexEntry } from '../api/contract';
import { ATLAS_STAGE_LABEL } from '../atlas/atlasCopy';
import { AtlasViewProvider, useAtlasBrowse } from '../atlas/AtlasViewContext';
import { AtlasViewStore } from '../atlas/AtlasViewStore';
import { MarkerChooser } from '../atlas/MarkerChooser';
import { MarkerHighlightProvider, type MarkerHighlight } from '../atlas/MarkerHighlightContext';
import { OpenContinentsProvider } from '../atlas/OpenContinentsContext';
import { toAtlasMarkers } from '../atlas/toAtlasMarkers';
import { toAtlasView } from '../atlas/toAtlasView';
import { useMarkerActivation } from '../atlas/useMarkerActivation';
import type { StageController } from '../stage/MountainScene';
import { SceneStore } from '../stage/SceneStore';
import { StageBoundary } from '../stage/StageBoundary';
import { useTransitionCoordinator } from '../stage/TransitionCoordinatorContext';
import { useOnUnitSystemChange } from '../units/UnitPreferenceContext';
import { LazyMountainScene } from './LazyMountainScene';
import { revealLabel } from './pageCopy';
import { mountainOf, type StageModel } from './pageModel';
import { toSceneTarget } from './sceneTarget';
import styles from './StageLayout.module.css';
import { StageShell } from './StageShell';

const NO_MOUNTAINS: readonly MountainIndexEntry[] = [];

interface StageLayoutProps {
	model: StageModel;
	children: ReactNode;
}

/**
 * The layout of every page built around the 3D stage. AppFrame renders it at one tree position
 * for each of them, so React keeps this instance, and with it the one Cesium Viewer, across client
 * navigation between the daily page, mountain pages and the atlas.
 *
 * A mountain page presents its mountain. The atlas presents none: entering it lets go of the
 * mountain shown before and flies to the overview, however it was reached. Only the atlas draws
 * its mountains on the globe, from the same index its list was rendered with, and a press on one
 * opens its page like its link in the list. The reader's filters live here too, so the list and
 * the globe draw the same mountains and a visit to a mountain page leaves them as they were.
 */
export function StageLayout({ model, children }: StageLayoutProps) {
	const coordinator = useTransitionCoordinator();
	const [store] = useState(() => new SceneStore());
	const [openContinents] = useState(() => new Set<string>());
	const [atlasView] = useState(() => new AtlasViewStore());
	const controller = useRef<StageController>(null);
	// Bound to whichever scene the stage hosts now; before the scene exists, or while it is being
	// rebuilt, an emphasis is simply not drawn.
	const [markerHighlight] = useState<MarkerHighlight>(() => ({
		highlight: (slug) => controller.current?.highlightMarker(slug)
	}));
	// Elevation bands are native to a unit, so the reader's own switch clears them wherever they are.
	useOnUnitSystemChange(() => atlasView.clearElevationForUnits());
	const onAtlas = model.kind === 'atlas';
	const target = onAtlas ? undefined : toSceneTarget(mountainOf(model));
	const { matches, view } = useAtlasBrowse(atlasView, onAtlas ? model.mountains : NO_MOUNTAINS);
	// The scene reconciles the markers it holds with these, so a mountain the filters leave out is
	// removed and one they let back in is drawn again, on the same Viewer and from the same camera.
	const markers = useMemo(
		() => (onAtlas ? toAtlasMarkers(matches) : undefined),
		[onAtlas, matches]
	);
	// The geographic filters decide where the camera rests; the stage moves it only when the places
	// they leave change, so a new elevation band or sort order never does.
	const atlas = useMemo(
		() => (onAtlas ? toAtlasView(view.filters, matches) : undefined),
		[onAtlas, view.filters, matches]
	);
	const { choice, activate, dismiss } = useMarkerActivation(markers);

	return (
		<OpenContinentsProvider value={openContinents}>
			<AtlasViewProvider value={atlasView}>
				<MarkerHighlightProvider value={markerHighlight}>
					<main className={`${styles.layout} ${onAtlas ? styles.atlas : styles.mountain}`}>
						{children}
						<StageShell
							store={store}
							label={onAtlas ? ATLAS_STAGE_LABEL : revealLabel(model.kind === 'daily')}
							className={styles.stage}
						>
							<StageBoundary store={store}>
								<LazyMountainScene
									store={store}
									target={target}
									atlas={atlas}
									markers={markers}
									observer={coordinator}
									controllerRef={controller}
									onMarkerActivate={onAtlas ? activate : undefined}
									onStageResize={dismiss}
								>
									{choice && <MarkerChooser choice={choice} onClose={dismiss} />}
								</LazyMountainScene>
							</StageBoundary>
						</StageShell>
					</main>
				</MarkerHighlightProvider>
			</AtlasViewProvider>
		</OpenContinentsProvider>
	);
}
