import { describe, expect, it } from 'vitest';
import type { MountainImage } from '../api/contract';
import {
	intrinsicDimensions,
	PAGE_SIZES,
	pageRendition,
	renditionUrl,
	renditionWidth,
	viewerTarget
} from './renditions';

const base =
	'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Everest.jpg/1280px-Everest.jpg';
const query = '?utm_source=commons.wikimedia.org&utm_campaign=imageinfo&utm_content=thumbnail';

const image: MountainImage = {
	url: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Everest.jpg',
	thumbnailUrl: `${base}${query}`,
	attribution: 'Someone',
	sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Everest.jpg',
	sourceIdentifier: 'File:Everest.jpg'
};

const desktop = { width: 1440, height: 900, devicePixelRatio: 2 };
const phone = { width: 390, height: 844, devicePixelRatio: 3 };

describe('renditionWidth', () => {
	it('reads the width of a Commons thumbnail', () => {
		expect(renditionWidth(base)).toBe(1280);
	});

	it('is undefined for URLs without a width', () => {
		expect(renditionWidth('https://upload.wikimedia.org/wikipedia/commons/a/a0/Everest.jpg')).toBe(
			undefined
		);
		expect(renditionWidth('not a url')).toBe(undefined);
	});
});

describe('renditionUrl', () => {
	it('rewrites only the width and keeps the query', () => {
		expect(renditionUrl(image.thumbnailUrl!, 960)).toBe(
			`https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Everest.jpg/960px-Everest.jpg${query}`
		);
	});

	it('refuses widths Wikimedia does not serve', () => {
		expect(renditionUrl(base, 800)).toBe(undefined);
		expect(renditionUrl(base, 3840)).toBe(undefined);
	});

	it('refuses URLs without a width', () => {
		expect(renditionUrl('https://thumb.wikimedia.org/everest.jpg', 960)).toBe(undefined);
	});
});

describe('pageRendition', () => {
	it('offers 500, 960 and 1280 wide candidates for a 1280px thumbnail', () => {
		const rendition = pageRendition(image);

		expect(rendition.src).toBe(image.thumbnailUrl);
		expect(rendition.sizes).toBe(PAGE_SIZES);
		expect(rendition.srcset?.split(', ')).toEqual([
			`https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Everest.jpg/500px-Everest.jpg${query} 500w`,
			`https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Everest.jpg/960px-Everest.jpg${query} 960w`,
			`${base}${query} 1280w`
		]);
	});

	it('never goes beyond the stored thumbnail width', () => {
		const narrow = pageRendition({
			...image,
			thumbnailUrl: renditionUrl(image.thumbnailUrl!, 960)
		});

		expect(narrow.srcset).not.toContain('1280w');
		expect(narrow.srcset?.split(', ')).toHaveLength(2);
	});

	it('uses a single source for an unscaled original', () => {
		const unscaled = `${image.url}?utm_content=thumbnail_unscaled`;

		expect(pageRendition({ ...image, thumbnailUrl: unscaled })).toEqual({ src: unscaled });
	});

	it('uses a single source for a thumbnail width Commons does not serve', () => {
		const odd = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/E.jpg/1000px-E.jpg';

		expect(pageRendition({ ...image, thumbnailUrl: odd })).toEqual({ src: odd });
	});

	it('falls back to the full image without a thumbnail', () => {
		expect(pageRendition({ ...image, thumbnailUrl: undefined })).toEqual({ src: image.url });
	});

	it('never picks a width above 1280 for the page', () => {
		expect(pageRendition(image).srcset).not.toContain('1920');
	});
});

describe('viewerTarget', () => {
	const current = { src: renditionUrl(image.thumbnailUrl!, 960)!, width: 960 };

	it('asks for 1920 on a large screen at 2x', () => {
		expect(viewerTarget(image, current, desktop, 1.5)).toEqual({
			src: renditionUrl(image.thumbnailUrl!, 1920),
			width: 1920
		});
	});

	it('caps the device pixel ratio at 2', () => {
		const tall = { width: 390, height: 844, devicePixelRatio: 5 };

		expect(viewerTarget(image, { src: 'x', width: 500 }, tall, 1.5)?.width).toBe(960);
	});

	it('keeps the page rendition when it is already enough on a phone', () => {
		expect(viewerTarget(image, { src: image.thumbnailUrl!, width: 1280 }, phone, 1.5)).toBe(
			undefined
		);
	});

	it('does not repeat the current source', () => {
		expect(
			viewerTarget(
				image,
				{ src: renditionUrl(image.thumbnailUrl!, 1920)!, width: 1920 },
				desktop,
				1.5
			)
		).toBe(undefined);
	});

	it('limits the width to the height available for a landscape photograph', () => {
		const short = { width: 1440, height: 500, devicePixelRatio: 1 };

		expect(viewerTarget(image, { src: 'x', width: 500 }, short, 1.5)?.width).toBe(960);
	});

	it('never requests above 1920', () => {
		const huge = { width: 5000, height: 3000, devicePixelRatio: 3 };

		expect(viewerTarget(image, { src: 'x', width: 500 }, huge, 1.5)?.width).toBe(1920);
	});

	it('has no upgrade for an unscaled original or an unknown thumbnail', () => {
		expect(
			viewerTarget(
				{ ...image, thumbnailUrl: `${image.url}?utm_content=thumbnail_unscaled` },
				current,
				desktop
			)
		).toBe(undefined);
		expect(viewerTarget({ ...image, thumbnailUrl: undefined }, current, desktop)).toBe(undefined);
	});

	it('has no upgrade for a degenerate viewport', () => {
		expect(viewerTarget(image, current, { width: 0, height: 0, devicePixelRatio: 2 }, 1.5)).toBe(
			undefined
		);
	});
});

describe('intrinsicDimensions', () => {
	it('accepts positive integer dimensions', () => {
		expect(intrinsicDimensions({ ...image, width: 4994, height: 2758 })).toEqual({
			width: 4994,
			height: 2758
		});
	});

	it('rejects absent, partial, zero, negative and fractional values', () => {
		expect(intrinsicDimensions(image)).toBe(undefined);
		expect(intrinsicDimensions({ ...image, width: 4994 })).toBe(undefined);
		expect(intrinsicDimensions({ ...image, width: 0, height: 10 })).toBe(undefined);
		expect(intrinsicDimensions({ ...image, width: -4, height: 10 })).toBe(undefined);
		expect(intrinsicDimensions({ ...image, width: 4.5, height: 10 })).toBe(undefined);
	});
});

describe('renditions capped by the original width', () => {
	const sized = (width: number, height = Math.round(width / 1.5)): MountainImage => ({
		...image,
		width,
		height
	});
	const start = { src: image.thumbnailUrl!, width: 1280 };

	it('keeps the full page ladder for originals at least as wide as the thumbnail', () => {
		expect(pageRendition(sized(4994)).srcset).toBe(pageRendition(image).srcset);
		expect(pageRendition(sized(1280)).srcset).toBe(pageRendition(image).srcset);
	});

	it('never lists a page candidate wider than the original', () => {
		const narrow = pageRendition({ ...sized(1000), thumbnailUrl: renditionUrl(base, 960) });

		expect(narrow.srcset).not.toContain('1280w');
		expect(narrow.srcset).toContain('960w');
	});

	it('does not request 1920 for an original narrower than 1920', () => {
		expect(viewerTarget(sized(1280), start, desktop, 1.5)).toBe(undefined);
		expect(viewerTarget(sized(1400), start, desktop, 1.5)).toBe(undefined);
		expect(viewerTarget(sized(1536), start, desktop, 1.5)).toBe(undefined);
	});

	it('requests 1920 when the original is at least as wide', () => {
		expect(viewerTarget(sized(1920), start, desktop, 1.5)?.width).toBe(1920);
		expect(viewerTarget(sized(2048), start, desktop, 1.5)?.width).toBe(1920);
		expect(viewerTarget(sized(4994), start, desktop, 1.5)?.width).toBe(1920);
	});

	it('uses the original file when it adds real resolution below 1920', () => {
		expect(viewerTarget(sized(1600), start, desktop, 1.5)).toEqual({
			src: image.url,
			width: 1600
		});
		expect(viewerTarget(sized(1908), start, desktop, 1.5)).toEqual({
			src: image.url,
			width: 1908
		});
	});

	it('does not use an original that is not a browser image format', () => {
		expect(
			viewerTarget(
				{ ...sized(1700), url: 'https://upload.wikimedia.org/a/a0/Everest.tif' },
				start,
				desktop,
				1.5
			)
		).toBe(undefined);
	});

	it('does not use the original when the viewport needs no more than the page rendition', () => {
		expect(viewerTarget(sized(1600), start, phone, 1.5)).toBe(undefined);
	});

	it('never exceeds the original even when the viewport asks for more', () => {
		const huge = { width: 5000, height: 3000, devicePixelRatio: 3 };

		for (const width of [1300, 1600, 1919, 1920, 2400, 4994]) {
			const target = viewerTarget(sized(width), { src: 'x', width: 500 }, huge, 1.5);

			expect(target === undefined || target.width <= width).toBe(true);
		}
	});

	it('keeps the previous behaviour when the original width is unknown', () => {
		expect(viewerTarget(image, start, desktop, 1.5)?.width).toBe(1920);
	});
});
