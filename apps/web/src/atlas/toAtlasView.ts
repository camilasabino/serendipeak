import type { MountainIndexEntry } from '../api/contract';
import { ATLAS_VIEW, type AtlasView } from '../stage/globe/atlasView';
import type { AtlasFilters } from './atlasFilter';

/**
 * What the stage frames for the reader's filters. Country and range are geographic: they bring the
 * camera to the mountains they leave. Elevation and sort are not, so the camera stays where it is
 * for them and the overview stays the overview.
 */
export function toAtlasView(
	filters: AtlasFilters,
	matches: readonly MountainIndexEntry[]
): AtlasView {
	if ((filters.country === null && filters.range === null) || matches.length === 0) {
		return ATLAS_VIEW;
	}

	return {
		...ATLAS_VIEW,
		focus: matches.map(({ coordinates }) => ({
			latitude: coordinates.latitude,
			longitude: coordinates.longitude
		}))
	};
}
