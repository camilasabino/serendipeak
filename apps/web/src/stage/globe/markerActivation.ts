import type { ScreenPoint } from './atlasMarkers';
import type { HitMountain } from './markerHits';

/**
 * A press on the atlas globe that reached markers: one mountain to open, or several close enough
 * on screen that the reader must say which, at the point pressed (CSS pixels from the top left of
 * the stage). The mountains come nearest first; how they are listed is the chooser's business.
 */
export type MarkerActivation =
	| { kind: 'mountain'; mountain: HitMountain }
	| { kind: 'choice'; mountains: HitMountain[]; at: ScreenPoint };
