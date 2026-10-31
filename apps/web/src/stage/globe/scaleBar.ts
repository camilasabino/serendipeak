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
const MAX_METERS = 2_000_000;
const NICE_STEPS = [1, 2, 5] as const;

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

export function niceDistanceMeters(maxMeters: number): number | undefined {
	if (!Number.isFinite(maxMeters) || maxMeters < MIN_METERS) {
		return undefined;
	}
	const exponent = Math.floor(Math.log10(maxMeters));
	for (let decade = exponent + 1; decade >= exponent; decade -= 1) {
		const magnitude = 10 ** decade;
		for (let index = NICE_STEPS.length - 1; index >= 0; index -= 1) {
			const candidate = NICE_STEPS[index]! * magnitude;
			if (candidate <= maxMeters * (1 + 1e-9)) {
				return candidate;
			}
		}
	}
	return undefined;
}

export function formatDistance(meters: number): string {
	if (meters >= 1000) {
		return `${integerFormat.format(meters / 1000)} km`;
	}
	return `${integerFormat.format(meters)} m`;
}

export function scaleBarFor(
	groundMeters: number,
	pixels: number,
	maxWidthPx: number
): ScaleReading | undefined {
	if (!(groundMeters > 0) || !(pixels > 0) || !(maxWidthPx > 0)) {
		return undefined;
	}
	const metersPerPixel = groundMeters / pixels;
	const meters = niceDistanceMeters(metersPerPixel * maxWidthPx);
	if (meters === undefined || meters > MAX_METERS) {
		return undefined;
	}
	const widthPx = meters / metersPerPixel;
	if (!Number.isFinite(widthPx) || widthPx <= 0) {
		return undefined;
	}
	return { widthPx, meters, label: formatDistance(meters) };
}
