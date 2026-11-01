import type { MountainImage } from '../api/contract';

export const MAX_VIEWER_DPR = 2;
export const ORIGINAL_MIN_GAIN = 1.25;

const THUMB_WIDTH = /\/(\d+)px-[^/?#]+(?:\?[^#]*)?$/;
const DISPLAYABLE_ORIGINAL = /\.(jpe?g|png|webp)(\?|#|$)/i;
const VIEWER_CHROME = { inline: 40, block: 124 } as const;

export interface PageRendition {
	src: string;
}

export interface ViewerViewport {
	width: number;
	height: number;
	devicePixelRatio: number;
}

export interface ViewerTarget {
	src: string;
	width: number;
}

export interface IntrinsicDimensions {
	width: number;
	height: number;
}

export function intrinsicDimensions(image: MountainImage): IntrinsicDimensions | undefined {
	const { width, height } = image;

	return Number.isInteger(width) && Number.isInteger(height) && width! > 0 && height! > 0
		? { width: width!, height: height! }
		: undefined;
}

// Reads the width a contract thumbnail declares in its path; no URL is ever built from it.
export function renditionWidth(url: string): number | undefined {
	const width = Number(THUMB_WIDTH.exec(url)?.[1]);

	return Number.isInteger(width) && width > 0 ? width : undefined;
}

export function pageRendition(image: MountainImage): PageRendition {
	return { src: image.thumbnailUrl ?? image.url };
}

export function viewerTarget(
	image: MountainImage,
	current: { src: string; width: number },
	viewport: ViewerViewport,
	ratio?: number
): ViewerTarget | undefined {
	const original = intrinsicDimensions(image);

	if (
		!original ||
		current.width <= 0 ||
		image.url === current.src ||
		!DISPLAYABLE_ORIGINAL.test(image.url) ||
		original.width < current.width * ORIGINAL_MIN_GAIN
	) {
		return undefined;
	}

	const dpr = Math.min(Math.max(viewport.devicePixelRatio || 1, 1), MAX_VIEWER_DPR);
	const fitWidth = viewport.width - VIEWER_CHROME.inline;
	const fitHeight = viewport.height - VIEWER_CHROME.block;
	const cssWidth =
		ratio && ratio > 0 ? Math.min(fitWidth, fitHeight * ratio) : Math.min(fitWidth, fitHeight);

	if (!(cssWidth > 0) || Math.ceil(cssWidth * dpr) <= current.width) {
		return undefined;
	}

	return { src: image.url, width: original.width };
}
