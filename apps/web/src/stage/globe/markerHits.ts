import type { ScreenBox, ScreenPoint } from './atlasMarkers';

/** How precisely the pointer that pressed can aim: a mouse or pen, or a finger. */
export type PointerPrecision = 'fine' | 'coarse';

/**
 * Hit areas around atlas markers, in CSS pixels.
 *
 * `radiusPixels` is how far from a marker's centre a press still reaches it: 12 px for a mouse,
 * 22 px for a finger.
 *
 * `clearancePixels` decides when a press is ambiguous. The nearest marker opens at once unless
 * another one in reach is less than this much farther from the pointer; then the press could
 * have meant either and the reader chooses. It is about half a point's width for a mouse and a
 * fingertip's wobble for touch, so a press on one marker of a pair a few pixels apart still opens
 * it, and only dots that merge on screen, or a press between two, ask.
 */
export const MARKER_HIT = {
	fine: { radiusPixels: 12, clearancePixels: 4 },
	coarse: { radiusPixels: 22, clearancePixels: 8 }
} as const satisfies Record<PointerPrecision, { radiusPixels: number; clearancePixels: number }>;

/** A marker drawn on screen, as the last visibility pass left it. */
export interface HitTarget {
	slug: string;
	name: string;
	elevationMeters: number;
	/** The marker's centre in CSS pixels from the top left of the canvas. */
	x: number;
	y: number;
	/** The plate of its label, while that label is shown. */
	label: ScreenBox | undefined;
}

export interface HitMountain {
	slug: string;
	name: string;
}

export type MarkerHit =
	| { kind: 'none' }
	| { kind: 'mountain'; mountain: HitMountain }
	/** At least two mountains, nearest first. */
	| { kind: 'choice'; mountains: HitMountain[] };

interface Candidate {
	target: HitTarget;
	distance: number;
}

function contains(box: ScreenBox, { x, y }: ScreenPoint): boolean {
	return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
}

// A press on a shown label is a press on its mountain, as close as a press on the dot.
function distanceTo(target: HitTarget, pointer: ScreenPoint): number {
	if (target.label && contains(target.label, pointer)) {
		return 0;
	}

	return Math.hypot(target.x - pointer.x, target.y - pointer.y);
}

// Sub-pixel differences mean nothing for a pointer, so distances compare in whole pixels, which
// keeps the order a strict, transitive one for the tie-breaks behind it.
function compareCandidates(a: Candidate, b: Candidate): number {
	const nearer = Math.round(a.distance) - Math.round(b.distance);
	if (nearer !== 0) {
		return nearer;
	}
	const higher = b.target.elevationMeters - a.target.elevationMeters;
	if (higher !== 0) {
		return higher;
	}

	return a.target.slug < b.target.slug ? -1 : a.target.slug > b.target.slug ? 1 : 0;
}

/**
 * The markers within reach of the pointer, in the order a reader would most likely mean them:
 * nearest first, then the higher summit, then by slug. O(n log n) over the visible markers.
 */
export function markersInReach(
	targets: Iterable<HitTarget>,
	pointer: ScreenPoint,
	radiusPixels: number
): Candidate[] {
	const reached: Candidate[] = [];
	for (const target of targets) {
		const distance = distanceTo(target, pointer);
		if (distance <= radiusPixels) {
			reached.push({ target, distance });
		}
	}

	return reached.sort(compareCandidates);
}

/**
 * What a press at `pointer` means. Only the markers handed in can be hit, so a mountain behind
 * the horizon or outside the canvas, which the visibility pass never lists, never is.
 */
export function resolveMarkerHit(
	targets: Iterable<HitTarget>,
	pointer: ScreenPoint,
	precision: PointerPrecision
): MarkerHit {
	const { radiusPixels, clearancePixels } = MARKER_HIT[precision];
	const reached = markersInReach(targets, pointer, radiusPixels);
	if (reached.length === 0) {
		return { kind: 'none' };
	}

	// Ambiguity is measured from the exact nearest distance, not from whichever marker the
	// whole-pixel order puts first: a tie broken by elevation must not change who is contending.
	const closest = Math.min(...reached.map(({ distance }) => distance));
	const contenders = reached.filter(({ distance }) => distance - closest < clearancePixels);
	const [first] = contenders;
	if (contenders.length === 1 && first) {
		return { kind: 'mountain', mountain: mountainOf(first.target) };
	}

	return { kind: 'choice', mountains: contenders.map(({ target }) => mountainOf(target)) };
}

function mountainOf({ slug, name }: HitTarget): HitMountain {
	return { slug, name };
}
