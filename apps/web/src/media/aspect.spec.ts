import { describe, expect, it } from 'vitest';
import type { MountainImage } from '../api/contract';
import { FALLBACK_RATIO, intrinsicRatio, pageRatio } from './aspect';

const image: MountainImage = {
	url: 'https://upload.wikimedia.org/wikipedia/commons/a/a0/Aconcagua.jpg',
	thumbnailUrl:
		'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/a0/Aconcagua.jpg/1280px-Aconcagua.jpg',
	width: 4994,
	height: 2758,
	attribution: 'Someone',
	sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Aconcagua.jpg',
	sourceIdentifier: 'File:Aconcagua.jpg'
};

const without = (patch: Partial<MountainImage>): MountainImage => ({ ...image, ...patch });

describe('intrinsicRatio', () => {
	it('is the width over the height of the original', () => {
		expect(intrinsicRatio(image)).toBeCloseTo(4994 / 2758, 6);
	});

	it('is undefined when a dimension is missing or invalid', () => {
		expect(intrinsicRatio(without({ width: undefined, height: undefined }))).toBe(undefined);
		expect(intrinsicRatio(without({ height: undefined }))).toBe(undefined);
		expect(intrinsicRatio(without({ width: 0 }))).toBe(undefined);
		expect(intrinsicRatio(without({ width: -5 }))).toBe(undefined);
		expect(intrinsicRatio(without({ width: 1.5 }))).toBe(undefined);
		expect(intrinsicRatio(without({ width: Number.NaN }))).toBe(undefined);
	});
});

describe('pageRatio', () => {
	it('reserves the natural ratio before anything is observed', () => {
		expect(pageRatio(image)).toBeCloseTo(4994 / 2758, 6);
		expect(pageRatio(image)).not.toBe(FALLBACK_RATIO);
	});

	it('keeps a portrait and a panoramic ratio instead of cropping to 3:2', () => {
		expect(pageRatio(without({ width: 1867, height: 2800 }))).toBeCloseTo(1867 / 2800, 6);
		expect(pageRatio(without({ width: 6000, height: 2000 }))).toBe(3);
	});

	it('keeps the intrinsic ratio when the decoded thumbnail only differs by rounding', () => {
		expect(pageRatio(image, 1280 / 707)).toBeCloseTo(4994 / 2758, 6);
	});

	it('trusts the decoded image when it contradicts the stored dimensions', () => {
		expect(pageRatio(image, 2 / 3)).toBe(2 / 3);
	});

	it('uses the generic ratio only when no dimensions exist', () => {
		const unknown = without({ width: undefined, height: undefined });

		expect(pageRatio(unknown)).toBe(FALLBACK_RATIO);
		expect(pageRatio(unknown, 1.8)).toBe(1.8);
		expect(pageRatio(unknown, 0)).toBe(FALLBACK_RATIO);
		expect(pageRatio(unknown, Number.NaN)).toBe(FALLBACK_RATIO);
	});
});
