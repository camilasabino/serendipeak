import { useCallback, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react';
import { LazyMountainScene } from '../../mountain-page/LazyMountainScene';
import { StageShell } from '../../mountain-page/StageShell';
import type { StageController } from '../../stage/MountainScene';
import { SceneStore } from '../../stage/SceneStore';
import { StageBoundary } from '../../stage/StageBoundary';
import { STAGE_REFERENCE_ASPECT } from '../../stage/globe/terrainCamera';
import { useTransitionCoordinator } from '../../stage/TransitionCoordinatorContext';
import styles from './CameraEditor.module.css';
import { CameraPanel, type PanelState } from './CameraPanel';
import { mountainAdminUrl, saveDestination } from './handoff';
import type { EditorRequest } from './editorQuery';
import { useCameraReadout } from './useCameraReadout';

interface CameraEditorProps {
	request: EditorRequest;
	adminBaseUrl: string;
}

export function CameraEditor({ request, adminBaseUrl }: CameraEditorProps) {
	const { mountainId, target, cameraOrigin } = request;
	const [store] = useState(() => new SceneStore());
	const coordinator = useTransitionCoordinator();
	const controller = useRef<StageController>(null);
	const { state, settled } = useSyncExternalStore(
		store.subscribe,
		store.getSnapshot,
		store.getSnapshot
	);

	const read = useCallback(() => controller.current?.readCamera(), []);
	const readout = useCameraReadout(read, state.status === 'ready' && settled);

	const panelState: PanelState = (() => {
		if (state.status === 'failed') {
			return { kind: 'unavailable' };
		}
		if (state.status === 'loading') {
			return { kind: 'loading' };
		}
		if (!settled || !readout) {
			return { kind: 'flying' };
		}
		return { kind: 'ready', assessment: readout };
	})();

	function save() {
		// The panel may show a pose from up to a sample ago: the value that is saved is read now.
		const destination = saveDestination(controller.current?.readCamera(), adminBaseUrl, mountainId);
		if (destination) {
			window.location.assign(destination);
		}
	}

	return (
		<main
			className={styles.editor}
			style={{ '--frame-aspect': STAGE_REFERENCE_ASPECT } as CSSProperties}
		>
			<div className={styles.workspace}>
				<StageShell store={store} daily={false} className={styles.frame}>
					<StageBoundary store={store}>
						<LazyMountainScene
							store={store}
							target={target}
							observer={coordinator}
							controllerRef={controller}
						/>
					</StageBoundary>
				</StageShell>
			</div>
			<CameraPanel
				name={target.name}
				cameraOrigin={cameraOrigin}
				state={panelState}
				canRestore={state.status === 'ready' && settled}
				backHref={mountainAdminUrl(adminBaseUrl, mountainId)}
				onSave={save}
				onRestore={() => controller.current?.resetView()}
			/>
		</main>
	);
}
