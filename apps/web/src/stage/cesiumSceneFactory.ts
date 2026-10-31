import { CesiumGlobeScene } from './globe/cesium/CesiumGlobeScene';
import { resolveImageryMode } from './globe/imagery';
import type { SceneFactory } from './StageBinding';

export interface CesiumStageConfig {
	isDevelopment: boolean;
	imageryMode: string | null;
}

// Evaluated at module level so the bundler folds the branch and omits the diagnostics module.
const E2E_DIAGNOSTICS = process.env.NEXT_PUBLIC_E2E_DIAGNOSTICS === '1';

export function cesiumSceneFactory({
	isDevelopment,
	imageryMode
}: CesiumStageConfig): SceneFactory {
	return ({ viewport }) =>
		async (ionToken, signal) => {
			const mode = resolveImageryMode(isDevelopment, imageryMode ?? undefined);
			const diagnostics = E2E_DIAGNOSTICS ? await import('./e2eDiagnostics') : undefined;

			return CesiumGlobeScene.create(
				viewport,
				{ ionToken, imageryMode: mode, exposeCameraReading: diagnostics?.exposeCameraReading },
				signal
			);
		};
}
