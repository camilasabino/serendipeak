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
			y: 200 + gapPixels
		});
	});

	it('moves above the point when there is no room below', () => {
		expect(placeChooser({ x: 400, y: 650 }, SIZE, DESKTOP)).toEqual({
			x: 400 - SIZE.width / 2,
			y: 650 - gapPixels - SIZE.height
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
		expect(placeChooser({ x: 50, y: 50 }, SIZE, { width: 120, height: 100 })).toEqual({
			x: marginPixels,
			y: marginPixels
		});
	});
});
