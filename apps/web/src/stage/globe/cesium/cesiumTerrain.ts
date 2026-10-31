import type { TerrainProvider } from 'cesium';
import {
	TERRAIN_SAMPLE_LEVEL,
	type GeographicPosition,
	type TerrainHeightSource
} from '../terrainCamera';
import type { CesiumModule } from './CesiumModule';

export function createCesiumTerrainSource(
	cesium: CesiumModule,
	provider: TerrainProvider
): TerrainHeightSource {
	return {
		async sampleHeights(positions: readonly GeographicPosition[]) {
			const cartographics = positions.map((position) =>
				cesium.Cartographic.fromDegrees(position.longitude, position.latitude)
			);
			const sampled = await cesium.sampleTerrain(
				provider,
				TERRAIN_SAMPLE_LEVEL,
				cartographics,
				true
			);

			return sampled.map((position) =>
				Number.isFinite(position.height) ? position.height : undefined
			);
		}
	};
}
