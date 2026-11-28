import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
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
import type { MarkerToggle } from '../stage/controls/StageControls';
import type { StageController } from '../stage/MountainScene';
import { SceneStore } from '../stage/SceneStore';
import { StageBoundary } from '../stage/StageBoundary';
import { useTransitionCoordinator } from '../stage/TransitionCoordinatorContext';
import type { NearbyMountain } from '../nearby/findNearbyMountains';
import { NearbyIndicators, sightedSummitsOf } from '../nearby/NearbyIndicators';
import { SightingFeed } from '../nearby/SightingFeed';
import { useOnUnitSystemChange } from '../units/UnitPreferenceContext';
import { LazyMountainScene } from './LazyMountainScene';
import { revealLabel } from './pageCopy';
import { mountainOf, type StageModel } from './pageModel';
import { toSceneTarget } from './sceneTarget';
import styles from './StageLayout.module.css';
import { StageShell } from './StageShell';

const NO_MOUNTAINS: readonly MountainIndexEntry[] = [];
const NO_NEARBY: readonly NearbyMountain[] = [];

interface StageLayoutProps {
	model: StageModel;
	/** The presented mountain's neighbours, as the page's props carry them. */
	nearby?: readonly NearbyMountain[];
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
 * the globe draw the same mountains and a visit to a mountain page leaves them as they were. So does
 * whether the globe draws markers at all, the atlas's and a mountain's summit alike: a presentation
 * choice kept apart from the filters, from the camera framing and from the page, so hiding takes
 * the markers away without touching the list, the mountain presented or the details panel.
 */
export function StageLayout({ model, nearby = NO_NEARBY, children }: StageLayoutProps) {
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
	const mountains = onAtlas ? model.mountains : NO_MOUNTAINS;
	const { matches, view } = useAtlasBrowse(atlasView, mountains);
	// The scene reconciles the markers it holds with these, so a mountain the filters leave out is
	// removed and one they let back in is drawn again, on the same Viewer and from the same camera.
	const markers = useMemo(
		() => (onAtlas ? toAtlasMarkers(matches) : undefined),
		[onAtlas, matches]
	);
	// The geographic filters, else the continent the reader is in, decide where the camera rests; the
	// stage moves it only when the places they frame change, so a new elevation band, a sort order or
	// a switch between a continent's mountains and ranges never does.
	const { filters, continent } = view;
	const atlas = useMemo(
		() => (onAtlas ? toAtlasView({ filters, continent }, mountains, matches) : undefined),
		[onAtlas, filters, continent, mountains, matches]
	);
	const [markersHidden, setMarkersHidden] = useState(false);
	const toggleMarkers = useCallback(() => setMarkersHidden((hidden) => !hidden), []);
	// One preference for every marker on the globe, reaching the scene by the path each kind already
	// has. The scene treats no atlas markers as nothing drawn, heard or hit, so hiding only changes
	// what the filtered set is handed on as; the summit marker is told whether it may be drawn, and
	// stays presented while it is not.
	const drawnMarkers = markersHidden ? undefined : markers;
	const markerToggle = useMemo<MarkerToggle>(
		() => ({ shown: !markersHidden, onToggle: toggleMarkers }),
		[markersHidden, toggleMarkers]
	);
	const { choice, activate, dismiss } = useMarkerActivation(drawnMarkers);
	// The same neighbours the details panel lists, pointed to from the stage while a mountain is
	// presented. Hiding markers hides these too: they are the stage's marks for other mountains.
	const [sightings] = useState(() => new SightingFeed());
	const pointedNearby = onAtlas || markersHidden ? NO_NEARBY : nearby;
	const nearbySummits = useMemo(() => sightedSummitsOf(pointedNearby), [pointedNearby]);

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
									markers={drawnMarkers}
									summitMarkerVisible={!markersHidden}
									markerToggle={markerToggle}
									mountainOrbit
									nearbySummits={nearbySummits}
									onSightings={sightings.publish}
									observer={coordinator}
									controllerRef={controller}
									onMarkerActivate={onAtlas ? activate : undefined}
									onStageResize={dismiss}
								>
									{choice && <MarkerChooser choice={choice} onClose={dismiss} />}
									{pointedNearby.length > 0 && (
										<NearbyIndicators mountains={pointedNearby} sightings={sightings} />
									)}
								</LazyMountainScene>
							</StageBoundary>
						</StageShell>
					</main>
				</MarkerHighlightProvider>
			</AtlasViewProvider>
		</OpenContinentsProvider>
	);
}
