import type { ScreenBox } from './atlasMarkers';
import { MARKER_LABEL_PLATE } from './marker';

/**
 * How atlas labels make room for each other.
 *
 * `gapPixels` keeps two shown plates from touching. A hidden label must clear its neighbours by
 * `returnPixels` more before it comes back, so a pair drifting along the edge of an overlap, as
 * the orbit or a slow pan moves it, does not blink. `maxLabels` bounds the glyph work a dense
 * catalog could ask of a weak renderer; the current catalog never comes near it.
 */
export const LABEL_DECLUTTER = {
	gapPixels: 2,
	returnPixels: 6,
	maxLabels: 50
} as const;

export interface LabelSize {
	width: number;
	height: number;
}

export interface LabelPlacement {
	/** The marker's centre in CSS pixels. */
	x: number;
	y: number;
	/** The rendered text, without its plate. */
	text: LabelSize;
	/** How far above the marker the plate's bottom edge sits. */
	offsetPixels: number;
}

/**
 * The plate Cesium draws for a label anchored at its bottom centre, raised `offsetPixels` above
 * the marker: the text plus the plate's padding on every side.
 */
export function labelBox({ x, y, text, offsetPixels }: LabelPlacement): ScreenBox {
	const { paddingPixels } = MARKER_LABEL_PLATE;
	const width = text.width + paddingPixels.x * 2;
	const height = text.height + paddingPixels.y * 2;
	const bottom = y - offsetPixels;

	return { left: x - width / 2, right: x + width / 2, top: bottom - height, bottom };
}

export interface LabelCandidate {
	slug: string;
	elevationMeters: number;
	box: ScreenBox;
	/** Past full legibility, fading out with distance. */
	fading: boolean;
	/** Whether the previous pass showed this label. */
	shown: boolean;
}

function overlaps(a: ScreenBox, b: ScreenBox, margin: number): boolean {
	return (
		a.left - margin < b.right &&
		b.left < a.right + margin &&
		a.top - margin < b.bottom &&
		b.top < a.bottom + margin
	);
}

function compareLabels(a: LabelCandidate, b: LabelCandidate): number {
	if (a.fading !== b.fading) {
		return a.fading ? 1 : -1;
	}
	const higher = b.elevationMeters - a.elevationMeters;
	if (higher !== 0) {
		return higher;
	}

	return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
}

/**
 * The labels to show among those within their distance: greedy by priority, each kept only if its
 * plate clears every plate already kept. A fully legible label outranks one fading out, so in an
 * oblique view a far ghost never hides a near name; among equals the higher summit wins, then the
 * slug. Priority does not depend on what was shown before, so a pose always settles on the same
 * names; only the return margin remembers the previous pass.
 *
 * O(n log n) for the sort plus O(n·k) overlap checks, k ≤ `maxLabels` kept; O(n) space.
 */
export function declutterLabels(
	candidates: readonly LabelCandidate[],
	options: typeof LABEL_DECLUTTER = LABEL_DECLUTTER
): Set<string> {
	const { gapPixels, returnPixels, maxLabels } = options;
	const kept: ScreenBox[] = [];
	const shown = new Set<string>();

	for (const candidate of [...candidates].sort(compareLabels)) {
		if (kept.length >= maxLabels) {
			break;
		}
		const margin = candidate.shown ? gapPixels : gapPixels + returnPixels;
		if (kept.some((box) => overlaps(candidate.box, box, margin))) {
			continue;
		}
		kept.push(candidate.box);
		shown.add(candidate.slug);
	}

	return shown;
}
