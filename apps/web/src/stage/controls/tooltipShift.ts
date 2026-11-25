export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface Shift {
	x: number;
	y: number;
}

export const TOOLTIP_EDGE_MARGIN_PX = 6;

/** The area both boxes cover, so a tooltip stays inside the stage and inside the window. */
export function intersectBoxes(a: Box, b: Box): Box {
	return {
		left: Math.max(a.left, b.left),
		top: Math.max(a.top, b.top),
		right: Math.min(a.right, b.right),
		bottom: Math.min(a.bottom, b.bottom)
	};
}

function axisShift(low: number, high: number, boundLow: number, boundHigh: number): number {
	if (high - low > boundHigh - boundLow) {
		return boundLow - low;
	}
	if (low < boundLow) {
		return boundLow - low;
	}
	return high > boundHigh ? boundHigh - high : 0;
}

/**
 * How far to move a tooltip, from where CSS put it, so it lies within `bounds` less `margin`.
 * One wider or taller than the bounds keeps its start edge in view, where its text begins.
 */
export function tooltipShift(
	tooltip: Box,
	bounds: Box,
	margin: number = TOOLTIP_EDGE_MARGIN_PX
): Shift {
	return {
		x: axisShift(tooltip.left, tooltip.right, bounds.left + margin, bounds.right - margin),
		y: axisShift(tooltip.top, tooltip.bottom, bounds.top + margin, bounds.bottom - margin)
	};
}
