import { describe, expect, it } from 'vitest';
import type { Mountain, MountainImage } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { intrinsicDimensions, pageRendition, viewerTarget } from './renditions';

const image = (contractFixture('mountain-complete.json') as Mountain).primaryImage as MountainImage;

const desktop = { width: 1440, height: 900, devicePixelRatio: 2 };
const phone = { width: 390, height: 844, devicePixelRatio: 3 };
const start = { src: image.thumbnailUrl!, width: 1280 };

function sized(width: number, height = Math.round(width / 1.5)): MountainImage {
	return { ...image, width, height };
}

function contractUrls(photo: MountainImage): string[] {
	return [photo.url, photo.thumbnailUrl].filter((url): url is string => url !== undefined);
}

describe('pageRendition', () => {
	it('uses the contract thumbnail as the only source, without a srcset', () => {
		expect(pageRendition(image)).toEqual({ src: image.thumbnailUrl });
	});

	it('falls back to the original when there is no thumbnail', () => {
		expect(pageRendition({ ...image, thumbnailUrl: undefined })).toEqual({ src: image.url });
	});

	it('never builds a URL: the source is exactly one of the contract URLs', () => {
		for (const photo of [image, sized(4994), { ...image, thumbnailUrl: undefined }]) {
			expect(contractUrls(photo)).toContain(pageRendition(photo).src);
			expect(Object.keys(pageRendition(photo))).toEqual(['src']);
		}
	});

	it('does not rewrite an unusual thumbnail', () => {
		const odd = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/E.jpg/1000px-E.jpg';

		expect(pageRendition({ ...image, thumbnailUrl: odd })).toEqual({ src: odd });
	});
});

describe('viewerTarget', () => {
	it('upgrades to the contract original when it adds real resolution', () => {
		expect(viewerTarget(sized(4994), start, desktop, 1.5)).toEqual({
			src: image.url,
			width: 4994
		});
	});

	it('only ever returns the contract original', () => {
		for (const width of [1600, 1920, 2400, 4994]) {
			const target = viewerTarget(sized(width), start, desktop, 1.5);

			expect(target?.src).toBe(image.url);
			expect(target?.width).toBe(width);
		}
	});

	it('has no upgrade when the original is not wide enough over the page image', () => {
		expect(viewerTarget(sized(1280), start, desktop, 1.5)).toBe(undefined);
		expect(viewerTarget(sized(1500), start, desktop, 1.5)).toBe(undefined);
		expect(viewerTarget(sized(1600), start, desktop, 1.5)).toEqual({
			src: image.url,
			width: 1600
		});
	});

	it('has no upgrade when the viewport needs no more than the page image', () => {
		expect(viewerTarget(sized(4994), start, phone, 1.5)).toBe(undefined);
	});

	it('has no upgrade when the original dimensions are unknown', () => {
		const bare = { ...image, width: undefined, height: undefined };

		expect(viewerTarget(bare, start, desktop, 1.5)).toBe(undefined);
		expect(viewerTarget({ ...bare, width: 4994 }, start, desktop, 1.5)).toBe(undefined);
	});

	it('has no upgrade for an original that is not a browser image format', () => {
		const tiff = { ...sized(4994), url: 'https://upload.wikimedia.org/a/a0/Everest.tif' };

		expect(viewerTarget(tiff, start, desktop, 1.5)).toBe(undefined);
	});

	it('does not repeat the source already shown', () => {
		expect(viewerTarget(sized(4994), { src: image.url, width: 1280 }, desktop, 1.5)).toBe(
			undefined
		);
	});

	it('has no upgrade when the shown width is unknown', () => {
		expect(viewerTarget(sized(4994), { src: start.src, width: 0 }, desktop, 1.5)).toBe(undefined);
	});

	it('has no upgrade when the page already shows an unscaled original', () => {
		const unscaled = { src: `${image.url}&utm_content=thumbnail_unscaled`, width: 4994 };

		expect(viewerTarget(sized(4994), unscaled, desktop, 1.5)).toBe(undefined);
	});

	it('has no upgrade for a degenerate viewport', () => {
		const degenerate = { width: 0, height: 0, devicePixelRatio: 2 };

		expect(viewerTarget(sized(4994), start, degenerate, 1.5)).toBe(undefined);
	});

	it('limits the demand to the height available for a landscape photograph', () => {
		const short = { width: 1440, height: 500, devicePixelRatio: 1 };

		expect(viewerTarget(sized(4994), start, short, 1.5)).toBe(undefined);
	});

	it('caps the device pixel ratio at 2', () => {
		const tall = { width: 700, height: 740, devicePixelRatio: 5 };

		expect(viewerTarget(sized(4994), { src: 'x', width: 1000 }, tall, 1.5)).toEqual({
			src: image.url,
			width: 4994
		});
		expect(viewerTarget(sized(4994), { src: 'x', width: 1400 }, tall, 1.5)).toBe(undefined);
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
		const bare = { ...image, width: undefined, height: undefined };

		expect(intrinsicDimensions(bare)).toBe(undefined);
		expect(intrinsicDimensions({ ...bare, width: 4994 })).toBe(undefined);
		expect(intrinsicDimensions({ ...image, width: 0, height: 10 })).toBe(undefined);
		expect(intrinsicDimensions({ ...image, width: -4, height: 10 })).toBe(undefined);
		expect(intrinsicDimensions({ ...image, width: 4.5, height: 10 })).toBe(undefined);
	});
});
