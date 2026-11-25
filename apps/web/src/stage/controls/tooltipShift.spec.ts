import { describe, expect, it } from 'vitest';
import { intersectBoxes, tooltipShift, type Box } from './tooltipShift';

const STAGE: Box = { left: 0, top: 0, right: 400, bottom: 300 };

function box(left: number, top: number, width: number, height: number): Box {
	return { left, top, right: left + width, bottom: top + height };
}

describe('tooltipShift', () => {
	it('leaves a tooltip that lies inside the bounds where it is', () => {
		expect(tooltipShift(box(100, 100, 120, 28), STAGE, 6)).toEqual({ x: 0, y: 0 });
	});

	it('moves a tooltip back in from the left and right edges', () => {
		expect(tooltipShift(box(-20, 100, 120, 28), STAGE, 6)).toEqual({ x: 26, y: 0 });
		expect(tooltipShift(box(310, 100, 120, 28), STAGE, 6)).toEqual({ x: -36, y: 0 });
	});

	it('moves a tooltip back in from the top and bottom edges', () => {
		expect(tooltipShift(box(100, -4, 120, 28), STAGE, 6)).toEqual({ x: 0, y: 10 });
		expect(tooltipShift(box(100, 285, 120, 28), STAGE, 6)).toEqual({ x: 0, y: -19 });
	});

	it('keeps the start edge in view when the tooltip is wider than the bounds', () => {
		expect(tooltipShift(box(-40, 100, 500, 28), STAGE, 6)).toEqual({ x: 46, y: 0 });
	});

	it('is exact at the margin', () => {
		expect(tooltipShift(box(6, 6, 100, 28), STAGE, 6)).toEqual({ x: 0, y: 0 });
	});
});

describe('intersectBoxes', () => {
	it('returns the area both boxes cover', () => {
		const stage = box(0, 80, 1000, 500);
		const viewport = box(0, 0, 800, 600);

		expect(intersectBoxes(stage, viewport)).toEqual({
			left: 0,
			top: 80,
			right: 800,
			bottom: 580
		});
	});
});
