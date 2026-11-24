import { DEFAULT_UNIT_SYSTEM, METERS_PER_FOOT, type UnitSystem } from '../../units/unitSystem';

export interface ScaleSpec {
	maxWidthPx: number;
	insetPx: number;
	bottomPx: number;
}

export interface ScaleReading {
	widthPx: number;
	meters: number;
	label: string;
}

const NARROW_STAGE_PX = 560;
export const WRAPPED_CREDITS_STAGE_PX = 380;
const BOTTOM_PX = 40;
const WRAPPED_CREDITS_BOTTOM_PX = 58;
const MIN_METERS = 1;
// Bounds the span the bar could cover, not the length picked: a system whose round steps are
// coarser (2,000 mi is 3,219 km) must not lose its bar over ground where the other still has one.
const MAX_SPAN_METERS = 5_000_000;
const NICE_STEPS = [1, 2, 5] as const;
const FEET_PER_MILE = 5280;
const METERS_PER_MILE = FEET_PER_MILE * METERS_PER_FOOT;
const ROUNDING_TOLERANCE = 1e-9;

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function scaleSpecForStage(stageWidth: number): ScaleSpec {
	const measured = stageWidth > 0;
	return {
		maxWidthPx: measured && stageWidth < NARROW_STAGE_PX ? 88 : 120,
		insetPx: 12,
		bottomPx:
			measured && stageWidth < WRAPPED_CREDITS_STAGE_PX ? WRAPPED_CREDITS_BOTTOM_PX : BOTTOM_PX
	};
}

/** The largest 1, 2 or 5 times a power of ten not above `max`, in whatever unit `max` is in. */
function niceStep(max: number): number | undefined {
	const exponent = Math.floor(Math.log10(max));
	for (let decade = exponent + 1; decade >= exponent; decade -= 1) {
		const magnitude = 10 ** decade;
		for (let index = NICE_STEPS.length - 1; index >= 0; index -= 1) {
			const candidate = NICE_STEPS[index]! * magnitude;
			if (candidate <= max * (1 + ROUNDING_TOLERANCE)) {
				return candidate;
			}
		}
	}
	return undefined;
}

/**
 * The longest round distance, in meters, that fits in `maxMeters`. Round means round in the
 * system's own units: 1, 2, 5 times a power of ten of meters then kilometers, or of feet below a
 * mile and of miles from it, never a metric step converted. Returns meters, the canonical unit,
 * so the bar's width follows from the same ground measurement in either system.
 */
export function niceDistanceMeters(
	maxMeters: number,
	system: UnitSystem = DEFAULT_UNIT_SYSTEM
): number | undefined {
	if (!Number.isFinite(maxMeters) || maxMeters < MIN_METERS) {
		return undefined;
	}
	if (system === 'metric') {
		return niceStep(maxMeters);
	}

	const maxFeet = maxMeters / METERS_PER_FOOT;
	if (maxFeet >= FEET_PER_MILE * (1 - ROUNDING_TOLERANCE)) {
		const miles = niceStep(maxFeet / FEET_PER_MILE);
		return miles === undefined ? undefined : miles * METERS_PER_MILE;
	}
	const feet = niceStep(maxFeet);
	return feet === undefined ? undefined : feet * METERS_PER_FOOT;
}

export function formatDistance(meters: number, system: UnitSystem = DEFAULT_UNIT_SYSTEM): string {
	if (system === 'imperial') {
		const feet = meters / METERS_PER_FOOT;
		if (feet >= FEET_PER_MILE * (1 - ROUNDING_TOLERANCE)) {
			return `${integerFormat.format(feet / FEET_PER_MILE)} mi`;
		}
		return `${integerFormat.format(feet)} ft`;
	}
	if (meters >= 1000) {
		return `${integerFormat.format(meters / 1000)} km`;
	}
	return `${integerFormat.format(meters)} m`;
}

export function scaleBarFor(
	groundMeters: number,
	pixels: number,
	maxWidthPx: number,
	system: UnitSystem = DEFAULT_UNIT_SYSTEM
): ScaleReading | undefined {
	if (!(groundMeters > 0) || !(pixels > 0) || !(maxWidthPx > 0)) {
		return undefined;
	}
	const metersPerPixel = groundMeters / pixels;
	const maxMeters = metersPerPixel * maxWidthPx;
	if (maxMeters * (1 + ROUNDING_TOLERANCE) >= MAX_SPAN_METERS) {
		return undefined;
	}
	const meters = niceDistanceMeters(maxMeters, system);
	if (meters === undefined) {
		return undefined;
	}
	const widthPx = meters / metersPerPixel;
	if (!Number.isFinite(widthPx) || widthPx <= 0) {
		return undefined;
	}
	return { widthPx, meters, label: formatDistance(meters, system) };
}
