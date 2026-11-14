import { describe, expect, it } from 'vitest';
import { CHOOSER_PLACEMENT, placeChooser } from './chooserPlacement';

const { gapPixels, marginPixels } = CHOOSER_PLACEMENT;
const SIZE = { width: 180, height: 140 };
const DESKTOP = { width: 900, height: 700 };
const PHONE = { width: 375, height: 460 };

describe('marker chooser placement', () => {
	it('sits centred below the point pressed when there is room', () => {
		expect(placeChooser({ x: 400, y: 200 }, SIZE, DESKTOP)).toEqual({
			x: 400 - SIZE.width / 2,
			y: 200 + gapPixels,
			maxHeight: SIZE.height
		});
	});

	it('moves above the point when there is no room below', () => {
		expect(placeChooser({ x: 400, y: 650 }, SIZE, DESKTOP)).toEqual({
			x: 400 - SIZE.width / 2,
			y: 650 - gapPixels - SIZE.height,
			maxHeight: SIZE.height
		});
	});

	it('stays inside the stage horizontally near either edge', () => {
		expect(placeChooser({ x: 10, y: 100 }, SIZE, PHONE).x).toBe(marginPixels);
		expect(placeChooser({ x: 370, y: 100 }, SIZE, PHONE).x).toBe(
			PHONE.width - SIZE.width - marginPixels
		);
	});

	it('stays inside a short stage when it fits neither above nor below', () => {
		const short = { width: 375, height: 200 };
		const placed = placeChooser({ x: 200, y: 100 }, SIZE, short);

		expect(placed.y).toBeGreaterThanOrEqual(marginPixels);
		expect(placed.y + SIZE.height).toBeLessThanOrEqual(short.height - marginPixels);
	});

	it('keeps its top-left corner inside a stage smaller than itself', () => {
		expect(placeChooser({ x: 50, y: 50 }, SIZE, { width: 120, height: 100 })).toMatchObject({
			x: marginPixels,
			y: marginPixels
		});
	});
});

describe('marker chooser height', () => {
	const TALL = { width: 220, height: 900 };

	it('is cut to the roomier side of the press, scrolling, when the list is taller than the stage', () => {
		const placed = placeChooser({ x: 200, y: 300 }, TALL, PHONE);

		expect(placed).toEqual({
			x: 200 - TALL.width / 2,
			y: marginPixels,
			maxHeight: 300 - gapPixels - marginPixels
		});
	});

	it('is cut to the stage, at its top margin, when the press leaves no usable room either side', () => {
		const stage = { width: 320, height: 200 };
		const placed = placeChooser({ x: 160, y: 100 }, { width: 304, height: 600 }, stage);

		expect(placed.maxHeight).toBe(stage.height - 2 * marginPixels);
		expect(placed.y).toBe(marginPixels);
	});

	it('is not cut at all when it fits', () => {
		expect(placeChooser({ x: 200, y: 100 }, SIZE, PHONE).maxHeight).toBe(SIZE.height);
	});

	it('keeps its whole box inside the stage for a press anywhere, however long the list', () => {
		for (const bounds of [PHONE, { width: 844, height: 288 }, { width: 320, height: 288 }]) {
			for (const height of [120, 300, 900]) {
				for (const x of [0, bounds.width / 2, bounds.width]) {
					for (const y of [0, bounds.height / 2, bounds.height]) {
						const placed = placeChooser({ x, y }, { width: 200, height }, bounds);
						const label = JSON.stringify({ bounds, height, x, y, placed });

						expect(placed.y, label).toBeGreaterThanOrEqual(marginPixels);
						expect(placed.y + placed.maxHeight, label).toBeLessThanOrEqual(
							bounds.height - marginPixels
						);
					}
				}
			}
		}
	});

	it('stays in a landscape phone stage, below a press near the top and above one near the bottom', () => {
		const landscape = { width: 844, height: 288 };
		const size = { width: 220, height: 150 };

		expect(placeChooser({ x: 420, y: 20 }, size, landscape).y).toBe(20 + gapPixels);
		expect(placeChooser({ x: 420, y: 270 }, size, landscape).y).toBe(270 - gapPixels - size.height);
	});

	it('keeps the stage bottom clear for the credits when the chooser fits above them', () => {
		const placed = placeChooser({ x: 200, y: 400 }, SIZE, PHONE, 58);

		expect(placed.y + placed.maxHeight).toBeLessThanOrEqual(PHONE.height - marginPixels - 58);
		expect(placed.y).toBe(400 - gapPixels - SIZE.height);
	});

	it('covers the credits rather than scroll sooner when it would not fit above them', () => {
		const size = { width: 200, height: PHONE.height - 2 * marginPixels - 30 };
		const placed = placeChooser({ x: 200, y: 20 }, size, PHONE, 58);

		expect(placed.maxHeight).toBe(size.height);
		expect(placed.y + placed.maxHeight).toBeLessThanOrEqual(PHONE.height - marginPixels);
	});

	it('reaches a stage with no height at all without a negative size', () => {
		expect(placeChooser({ x: 0, y: 0 }, SIZE, { width: 300, height: 0 })).toMatchObject({
			maxHeight: 0
		});
	});
});

describe('marker chooser and the fingertip', () => {
	const covers = (
		at: { x: number; y: number },
		size: { width: number; height: number },
		bounds = PHONE
	) => {
		const placed = placeChooser(at, size, bounds);

		return (
			at.x >= placed.x &&
			at.x <= placed.x + size.width &&
			at.y >= placed.y &&
			at.y <= placed.y + placed.maxHeight
		);
	};

	it('never lies under the press where a side has room for a usable list', () => {
		const wide = { width: 220, height: 400 };
		for (const y of [60, 150, 230, 300, 400]) {
			for (const x of [20, 160, 300]) {
				expect(covers({ x, y }, wide), JSON.stringify({ x, y })).toBe(false);
			}
		}
	});

	it('goes beside the press on a stage too short for a list above or below it', () => {
		const landscape = { width: 844, height: 200 };
		const size = { width: 220, height: 300 };

		const right = placeChooser({ x: 200, y: 100 }, size, landscape);
		const left = placeChooser({ x: 700, y: 100 }, size, landscape);

		expect(right.x).toBe(200 + gapPixels);
		expect(left.x).toBe(700 - gapPixels - size.width);
		expect(covers({ x: 200, y: 100 }, size, landscape)).toBe(false);
		expect(covers({ x: 700, y: 100 }, size, landscape)).toBe(false);
	});
});
