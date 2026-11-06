// Mirrors services/api catalog/camera.py; the bounds belong to the frozen v1 contract.
export const HEADING_MIN = 0;
export const HEADING_MAX_EXCLUSIVE = 360;
export const PITCH_MIN = -60;
export const PITCH_MAX = 15;
export const RANGE_MIN = 2_000;
export const RANGE_MAX = 80_000;
export const FRAMING_LIMIT = 1;

export function isHeadingInBounds(value: number): boolean {
	return value >= HEADING_MIN && value < HEADING_MAX_EXCLUSIVE;
}

export function isPitchInBounds(value: number): boolean {
	return value >= PITCH_MIN && value <= PITCH_MAX;
}

export function isRangeInBounds(value: number): boolean {
	return value >= RANGE_MIN && value <= RANGE_MAX;
}

export function isFramingInBounds(value: number): boolean {
	return value >= -FRAMING_LIMIT && value <= FRAMING_LIMIT;
}
