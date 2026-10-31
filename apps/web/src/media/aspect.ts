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
