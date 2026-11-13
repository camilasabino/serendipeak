import type { ScreenPoint } from './atlasMarkers';
import type { HitMountain } from './markerHits';

/**
 * A press on the atlas globe that reached markers: one mountain to open, or several close enough
 * on screen that the reader must say which, offered nearest first at the point pressed (CSS
 * pixels from the top left of the stage).
 */
export type MarkerActivation =
	| { kind: 'mountain'; mountain: HitMountain }
	| { kind: 'choice'; mountains: HitMountain[]; at: ScreenPoint };
