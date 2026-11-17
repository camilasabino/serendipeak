import type { MountainImage } from '../api/contract';
import { intrinsicDimensions } from './renditions';

export const FALLBACK_RATIO = 3 / 2;
export const RATIO_TOLERANCE = 0.01;

export function intrinsicRatio(image: MountainImage): number | undefined {
	const dimensions = intrinsicDimensions(image);

	return dimensions ? dimensions.width / dimensions.height : undefined;
}

export function pageRatio(image: MountainImage, observed?: number): number {
	const intrinsic = intrinsicRatio(image);
	const usable = observed !== undefined && Number.isFinite(observed) && observed > 0;

	if (intrinsic === undefined) {
		return usable ? observed : FALLBACK_RATIO;
	}

	return usable && Math.abs(observed / intrinsic - 1) > RATIO_TOLERANCE ? observed : intrinsic;
}

export const PLATE_RATIO_MIN = 4 / 3;
export const PLATE_RATIO_MAX = 2;
export const PLATE_MAT_TOLERANCE = 0.1;

export interface PlateFrame {
	ratio: number;
	/** The photograph is shown whole on a mat instead of being cropped to the frame. */
	matted: boolean;
}

/**
 * The sheet's frame keeps a bounded shape so a panorama or a portrait cannot take over the
 * column. A photograph within the tolerance of the bounded ratio fills the frame; any other is
 * shown whole on a mat, because cropping it would cut the mountain.
 */
export function plateFrame(naturalRatio: number): PlateFrame {
	const ratio = Math.min(PLATE_RATIO_MAX, Math.max(PLATE_RATIO_MIN, naturalRatio));
	const matted = Math.abs(naturalRatio - ratio) / ratio > PLATE_MAT_TOLERANCE;

	return { ratio, matted };
}
