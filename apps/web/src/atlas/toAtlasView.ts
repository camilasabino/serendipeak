import type { MountainIndexEntry } from '../api/contract';
import { ATLAS_VIEW, type AtlasView } from '../stage/globe/atlasView';
import { scopeMountains } from './atlasFilter';
import type { AtlasView as ReaderView } from './AtlasViewStore';

function focusOn(places: readonly MountainIndexEntry[]): AtlasView {
	return {
		...ATLAS_VIEW,
		focus: places.map(({ coordinates }) => ({
			latitude: coordinates.latitude,
			longitude: coordinates.longitude
		}))
	};
}

/**
 * What the stage frames for where the reader is. A country or range is the most specific place and
 * brings the camera to the mountains the filters leave (`matches`). Otherwise a continent the reader
 * has gone into brings it to all of that continent's mountains in the catalog, however elevation
 * narrows them: elevation and sort say nothing about where to look, and neither does a switch
 * between a continent's mountains and its ranges, so none of them may move the camera. With no
 * geographic choice at all, the overview stays the overview. O(n) for n mountains.
 */
export function toAtlasView(
	{ filters, continent }: Pick<ReaderView, 'filters' | 'continent'>,
	mountains: readonly MountainIndexEntry[],
	matches: readonly MountainIndexEntry[]
): AtlasView {
	if ((filters.country !== null || filters.range !== null) && matches.length > 0) {
		return focusOn(matches);
	}
	if (continent === null) {
		return ATLAS_VIEW;
	}

	const places = scopeMountains(mountains, { kind: 'continent', code: continent.code });

	return places.length > 0 ? focusOn(places) : ATLAS_VIEW;
}
