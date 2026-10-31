import type { MountainImage } from '../api/contract';

export const PAGE_WIDTHS: readonly number[] = [500, 960, 1280];
export const VIEWER_WIDTHS: readonly number[] = [960, 1280, 1920];
const ALLOWED_WIDTHS: readonly number[] = [...PAGE_WIDTHS, 1920];
export const MAX_VIEWER_DPR = 2;
export const ORIGINAL_MIN_GAIN = 1.25;
export const PAGE_SIZES = '(min-width: 56rem) 25rem, calc(100vw - 3rem)';

const THUMB = /^(https:\/\/.*\/)(\d+)px-([^/?#]+)(\?[^#]*)?$/;
const MAX_VIEWER_WIDTH = VIEWER_WIDTHS[VIEWER_WIDTHS.length - 1]!;
const DISPLAYABLE_ORIGINAL = /\.(jpe?g|png|webp)(\?|#|$)/i;
const VIEWER_CHROME = { inline: 40, block: 124 } as const;

export interface PageRendition {
	src: string;
	srcset?: string;
	sizes?: string;
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

function parseThumbnail(url: string) {
	const match = THUMB.exec(url);

	if (!match) {
		return undefined;
	}

	const width = Number(match[2]);

	return Number.isInteger(width) && width > 0
		? { prefix: match[1], width, name: match[3], query: match[4] ?? '' }
		: undefined;
}

export function renditionWidth(url: string): number | undefined {
	return parseThumbnail(url)?.width;
}

export function renditionUrl(thumbnailUrl: string, width: number): string | undefined {
	const parsed = parseThumbnail(thumbnailUrl);

	if (!parsed || !ALLOWED_WIDTHS.includes(width)) {
		return undefined;
	}

	return `${parsed.prefix}${width}px-${parsed.name}${parsed.query}`;
}

export function pageRendition(image: MountainImage): PageRendition {
	const src = image.thumbnailUrl ?? image.url;
	const parsed = image.thumbnailUrl ? parseThumbnail(image.thumbnailUrl) : undefined;

	if (!parsed) {
		return { src };
	}

	const limit = Math.min(parsed.width, intrinsicDimensions(image)?.width ?? Infinity);
	const widths = PAGE_WIDTHS.filter((width) => width <= limit);
	const candidates = widths.flatMap((width) => {
		const url = renditionUrl(src, width);
		return url ? [`${url} ${width}w`] : [];
	});

	if (candidates.length < 2 || !widths.includes(parsed.width)) {
		return { src };
	}

	return { src, srcset: candidates.join(', '), sizes: PAGE_SIZES };
}

function viewerCandidates(image: MountainImage, thumbnail: string): ViewerTarget[] {
	const original = intrinsicDimensions(image)?.width;
	const candidates = VIEWER_WIDTHS.filter(
		(width) => original === undefined || width <= original
	).flatMap((width) => {
		const src = renditionUrl(thumbnail, width);
		return src ? [{ src, width }] : [];
	});
	const largest = candidates.at(-1)?.width ?? 0;

	if (
		original !== undefined &&
		largest > 0 &&
		original >= largest * ORIGINAL_MIN_GAIN &&
		original < MAX_VIEWER_WIDTH &&
		DISPLAYABLE_ORIGINAL.test(image.url)
	) {
		candidates.push({ src: image.url, width: original });
	}

	return candidates;
}

export function viewerTarget(
	image: MountainImage,
	current: { src: string; width: number },
	viewport: ViewerViewport,
	ratio?: number
): ViewerTarget | undefined {
	const thumbnail = image.thumbnailUrl;
	const parsed = thumbnail ? parseThumbnail(thumbnail) : undefined;

	if (!thumbnail || !parsed || !PAGE_WIDTHS.includes(parsed.width)) {
		return undefined;
	}

	const dpr = Math.min(Math.max(viewport.devicePixelRatio || 1, 1), MAX_VIEWER_DPR);
	const fitWidth = viewport.width - VIEWER_CHROME.inline;
	const fitHeight = viewport.height - VIEWER_CHROME.block;
	const cssWidth =
		ratio && ratio > 0 ? Math.min(fitWidth, fitHeight * ratio) : Math.min(fitWidth, fitHeight);

	if (!(cssWidth > 0)) {
		return undefined;
	}

	const wanted = Math.ceil(cssWidth * dpr);
	const candidates = viewerCandidates(image, thumbnail);
	const chosen = candidates.find((candidate) => candidate.width >= wanted) ?? candidates.at(-1);

	return chosen && chosen.width > current.width && chosen.src !== current.src ? chosen : undefined;
}
