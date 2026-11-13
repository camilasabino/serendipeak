export interface Point {
	x: number;
	y: number;
}

export interface Size {
	width: number;
	height: number;
}

/**
 * Where the marker chooser sits relative to the point pressed, in CSS pixels. The gap keeps it
 * off the fingertip that opened it, and the margin off the stage edges.
 */
export const CHOOSER_PLACEMENT = {
	gapPixels: 12,
	marginPixels: 8
} as const;

function clamp(value: number, low: number, high: number): number {
	return high < low ? low : Math.min(Math.max(value, low), high);
}

/**
 * Centred under the point pressed, or above it where there is no room below, and always kept
 * inside the stage. A chooser larger than the stage keeps its top-left corner inside.
 */
export function placeChooser(at: Point, size: Size, bounds: Size): Point {
	const { gapPixels, marginPixels } = CHOOSER_PLACEMENT;
	const lowest = bounds.height - size.height - marginPixels;
	const below = at.y + gapPixels;
	const above = at.y - gapPixels - size.height;
	const preferred = below <= lowest || above < marginPixels ? below : above;

	return {
		x: clamp(at.x - size.width / 2, marginPixels, bounds.width - size.width - marginPixels),
		y: clamp(preferred, marginPixels, lowest)
	};
}
