export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

export interface ChooserPlacement extends Point {
	/** The tallest the chooser may be where it stands; a longer list scrolls inside it. */
	maxHeight: number;
}

/**
 * Where the marker chooser sits relative to the point pressed, in CSS pixels. The gap keeps it
 * off the fingertip that opened it, and the margin off the stage edges. `minHeightPixels` is the
 * least list worth showing beside the point: its header and two entries, at the touch target.
 */
export const CHOOSER_PLACEMENT = {
	gapPixels: 12,
	marginPixels: 8,
	minHeightPixels: 132
} as const;

function clamp(value: number, low: number, high: number): number {
	return high < low ? low : Math.min(Math.max(value, low), high);
}

/**
 * Beside the point pressed and inside the stage, never under the fingertip that opened it: a
 * finger lifting there sends the browser's own click to whatever now stands beneath, which would
 * open a mountain nobody chose. In order of preference, it is
 *
 * 1. centred below the point, or above it, where the whole list fits;
 * 2. on the roomier of those sides, cut short and scrolling, where it still holds a usable list;
 * 3. to the left or right of the point, where the stage is too short for either;
 * 4. against the bottom edge, covering the point, where nothing else fits.
 *
 * `size` is the chooser's natural size, as it would be with nothing cutting it short. A chooser
 * taller than the stage is cut to it, and one wider than the stage keeps its left edge inside. The
 * strip of `reservedBottomPixels`, where the globe's credits and scale stand, is kept clear
 * whenever the whole chooser still fits above it; otherwise the chooser may cover it rather than
 * scroll sooner.
 */
export function placeChooser(
	at: Point,
	size: Size,
	bounds: Size,
	reservedBottomPixels = 0
): ChooserPlacement {
	const { gapPixels, marginPixels, minHeightPixels } = CHOOSER_PLACEMENT;
	const stageRoom = Math.max(bounds.height - 2 * marginPixels, 0);
	const reserved = size.height <= stageRoom - reservedBottomPixels ? reservedBottomPixels : 0;
	const floor = bounds.height - marginPixels - reserved;
	const height = Math.max(Math.min(size.height, floor - marginPixels), 0);
	const centred = clamp(
		at.x - size.width / 2,
		marginPixels,
		bounds.width - size.width - marginPixels
	);

	const below = at.y + gapPixels;
	const above = at.y - gapPixels;
	if (below + height <= floor) {
		return { x: centred, y: below, maxHeight: Math.floor(height) };
	}
	if (above - height >= marginPixels) {
		return { x: centred, y: above - height, maxHeight: Math.floor(height) };
	}

	const roomBelow = floor - below;
	const roomAbove = above - marginPixels;
	const roomier = Math.max(roomBelow, roomAbove);
	if (roomier >= Math.min(minHeightPixels, height)) {
		return roomBelow >= roomAbove
			? { x: centred, y: below, maxHeight: Math.floor(roomBelow) }
			: { x: centred, y: marginPixels, maxHeight: Math.floor(roomAbove) };
	}

	const roomRight = bounds.width - marginPixels - (at.x + gapPixels);
	const roomLeft = at.x - gapPixels - marginPixels;
	if (Math.max(roomRight, roomLeft) >= size.width) {
		return {
			x: roomRight >= roomLeft ? at.x + gapPixels : at.x - gapPixels - size.width,
			y: clamp(at.y - height / 2, marginPixels, floor - height),
			maxHeight: Math.floor(height)
		};
	}

	return {
		x: centred,
		y: clamp(below, marginPixels, floor - height),
		maxHeight: Math.floor(height)
	};
}
