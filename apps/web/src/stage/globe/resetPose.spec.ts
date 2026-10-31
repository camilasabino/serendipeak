import { describe, expect, it } from 'vitest';
import type { SceneTarget } from './camera';
import { lookFromOffset } from './choreography';
import { isLookAtOffset } from './resetPose';
import type { CesiumCameraOffset } from './terrainCamera';

const TARGET: SceneTarget = {
	slug: 'matterhorn',
	name: 'Matterhorn',
	latitude: 45.9763,
	longitude: 7.6586,
	elevationMeters: 4478
};

const OFFSET: CesiumCameraOffset = {
	headingRadians: (200 * Math.PI) / 180,
	pitchRadians: (-18 * Math.PI) / 180,
	rollRadians: 0,
	rangeMeters: 9_000,
	framingX: 0.2,
	framingY: -0.1
};

describe('isLookAtOffset', () => {
	it('accepts the exact pose', () => {
		expect(isLookAtOffset(lookFromOffset(TARGET, OFFSET), TARGET, OFFSET)).toBe(true);
	});

	it('accepts numerical noise', () => {
		const look = {
			...lookFromOffset(TARGET, OFFSET),
			headingDegrees: 200.1,
			pitchDegrees: -18.1,
			rangeMeters: 9_010,
			framingX: 0.205
		};

		expect(isLookAtOffset(look, TARGET, OFFSET)).toBe(true);
	});

	it.each([
		['heading', { headingDegrees: 203 }],
		['pitch', { pitchDegrees: -12 }],
		['range', { rangeMeters: 9_500 }],
		['framing x', { framingX: 0.4 }],
		['framing y', { framingY: 0.1 }]
	])('rejects a disturbed %s', (_name, change) => {
		const look = { ...lookFromOffset(TARGET, OFFSET), ...change };

		expect(isLookAtOffset(look, TARGET, OFFSET)).toBe(false);
	});

	it('can ignore the framing, which depends on the stage aspect', () => {
		const look = { ...lookFromOffset(TARGET, OFFSET), framingX: 0.9, framingY: 0.9 };

		expect(isLookAtOffset(look, TARGET, OFFSET)).toBe(false);
		expect(isLookAtOffset(look, TARGET, OFFSET, { framing: false })).toBe(true);
		expect(
			isLookAtOffset({ ...look, rangeMeters: 12_000 }, TARGET, OFFSET, { framing: false })
		).toBe(false);
	});

	it('compares headings across the 0 and 360 boundary', () => {
		const north = { ...OFFSET, headingRadians: 0 };
		const look = { ...lookFromOffset(TARGET, north), headingDegrees: 359.8 };

		expect(isLookAtOffset(look, TARGET, north)).toBe(true);
	});
});
