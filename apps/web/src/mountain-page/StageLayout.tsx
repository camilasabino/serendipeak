import { useState, type ReactNode } from 'react';
import { ATLAS_STAGE_LABEL } from '../atlas/atlasCopy';
import { OpenContinentsProvider } from '../atlas/OpenContinentsContext';
import { ATLAS_VIEW } from '../stage/globe/atlasView';
import { SceneStore } from '../stage/SceneStore';
import { StageBoundary } from '../stage/StageBoundary';
import { useTransitionCoordinator } from '../stage/TransitionCoordinatorContext';
import { LazyMountainScene } from './LazyMountainScene';
import { revealLabel } from './pageCopy';
import { mountainOf, type StageModel } from './pageModel';
import { toSceneTarget } from './sceneTarget';
import styles from './StageLayout.module.css';
import { StageShell } from './StageShell';

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
 * mountain shown before and flies to the overview, however it was reached.
 */
export function StageLayout({ model, children }: StageLayoutProps) {
	const coordinator = useTransitionCoordinator();
	const [store] = useState(() => new SceneStore());
	const [openContinents] = useState(() => new Set<string>());
	const onAtlas = model.kind === 'atlas';
	const target = onAtlas ? undefined : toSceneTarget(mountainOf(model));

	return (
		<OpenContinentsProvider value={openContinents}>
			<main className={onAtlas ? `${styles.layout} ${styles.atlas}` : styles.layout}>
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
							atlas={onAtlas ? ATLAS_VIEW : undefined}
							observer={coordinator}
						/>
					</StageBoundary>
				</StageShell>
			</main>
		</OpenContinentsProvider>
	);
}
