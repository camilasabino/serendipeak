import type { ScreenBox } from '../stage/globe/atlasMarkers';

export function grow(box: ScreenBox, by: number): ScreenBox {
	return { left: box.left - by, top: box.top - by, right: box.right + by, bottom: box.bottom + by };
}

export function overlaps(a: ScreenBox, b: ScreenBox): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

export function within(box: ScreenBox, frame: ScreenBox): boolean {
	return (
		box.left >= frame.left &&
		box.top >= frame.top &&
		box.right <= frame.right &&
		box.bottom <= frame.bottom
	);
}

/** `value` held within [min, max]; `min` when the range is empty. */
export function clamp(value: number, min: number, max: number): number {
	return max < min ? min : Math.min(Math.max(value, min), max);
}
