import type { MountainIndexEntry } from '../api/contract';
import type { AtlasMarker } from '../stage/globe/atlasMarkers';

export function toAtlasMarkers(mountains: readonly MountainIndexEntry[]): AtlasMarker[] {
	return mountains.map(({ slug, name, coordinates, elevationMeters }) => ({
		slug,
		name,
		latitude: coordinates.latitude,
		longitude: coordinates.longitude,
		elevationMeters
	}));
}
