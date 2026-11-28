import { describe, expect, it } from 'vitest';
import type { ScreenBox } from '../stage/globe/atlasMarkers';
import {
	CLEARANCE_PX,
	EDGE_INSET_PX,
	placeIndicators,
	type IndicatorBox,
	type IndicatorRequest,
	type PlacementFrame
} from './placeIndicators';

const LABEL = { width: 120, height: 44 };

function request(slug: string, dx: number, dy: number, size = LABEL): IndicatorRequest {
	const length = Math.hypot(dx, dy);
	return { slug, dx: dx / length, dy: dy / length, ...size };
}

function boxOf(placed: IndicatorBox, size = LABEL): ScreenBox {
	return {
		left: placed.left,
		top: placed.top,
		right: placed.left + size.width,
		bottom: placed.top + size.height
	};
}

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

const DESKTOP: PlacementFrame = { width: 960, height: 600, obstacles: [] };

describe('placeIndicators', () => {
	it.each([
		['right', 1, 0, { left: 960 - EDGE_INSET_PX - 120, top: 300 - 22 }],
		['left', -1, 0, { left: EDGE_INSET_PX, top: 300 - 22 }],
		['top', 0, -1, { left: 480 - 60, top: EDGE_INSET_PX }],
		['bottom', 0, 1, { left: 480 - 60, top: 600 - EDGE_INSET_PX - 44 }]
	] as const)('places a summit off the %s against that edge, inset from it', (edge, dx, dy, at) => {
		expect(placeIndicators([request('a', dx, dy)], DESKTOP)).toEqual([{ slug: 'a', edge, ...at }]);
	});

	it('uses the edge a ray from the centre leaves through, centred where it leaves', () => {
		// Up and to the right at 15° from horizontal: the ray reaches the right edge first on a wide stage.
		const angle = Math.PI / 12;
		const [placed] = placeIndicators([request('a', Math.cos(angle), -Math.sin(angle))], DESKTOP);
		const exitY = 300 - (960 / 2 - EDGE_INSET_PX) * Math.tan(angle);

		expect(placed?.edge).toBe('right');
		expect(placed!.top + 22).toBeCloseTo(exitY, 6);

		// Steeper than the stage's diagonal: the top edge.
		expect(placeIndicators([request('b', 0.5, -1)], DESKTOP)[0]?.edge).toBe('top');
	});

	it('keeps a label near a corner inside the inset frame', () => {
		const [placed] = placeIndicators([request('a', 1, -0.62)], DESKTOP);

		expect(placed!.left).toBeGreaterThanOrEqual(EDGE_INSET_PX);
		expect(placed!.top).toBeGreaterThanOrEqual(EDGE_INSET_PX);
		expect(placed!.left + 120).toBeLessThanOrEqual(960 - EDGE_INSET_PX);
	});

	it('pushes a label inward past a control on its edge, keeping its height', () => {
		const toolbar: ScreenBox = { left: 900, top: 10, right: 950, bottom: 400 };

		const [placed] = placeIndicators([request('a', 1, 0)], { ...DESKTOP, obstacles: [toolbar] });

		expect(placed).toEqual({
			slug: 'a',
			edge: 'right',
			left: toolbar.left - CLEARANCE_PX - 120,
			top: 278
		});
	});

	it('slides a label along its edge when that is the shorter way around a control', () => {
		const chip: ScreenBox = { left: 400, top: 560, right: 560, bottom: 590 };

		const [placed] = placeIndicators([request('a', 0, 1)], { ...DESKTOP, obstacles: [chip] });

		expect(placed?.edge).toBe('bottom');
		expect(overlaps(boxOf(placed!), chip)).toBe(false);
	});

	it('gives the first request its place and moves the next aside, never overlapping them', () => {
		const placed = placeIndicators([request('near', 1, 0), request('far', 1, 0.02)], DESKTOP);

		expect(placed.map((box) => box.slug)).toEqual(['near', 'far']);
		expect(placed[0]).toMatchObject({ edge: 'right', top: 278 });
		expect(overlaps(boxOf(placed[0]!), boxOf(placed[1]!))).toBe(false);
	});

	it('leaves out a lower-priority label rather than overlap a control or another label', () => {
		const frame: PlacementFrame = {
			width: 320,
			height: 160,
			obstacles: [{ left: 0, top: 0, right: 320, bottom: 50 }]
		};

		const placed = placeIndicators(
			[request('a', 1, 0), request('b', 1, 0.01), request('c', 1, -0.01)],
			frame
		);

		expect(placed.length).toBeLessThan(3);
		expect(placed[0]?.slug).toBe('a');
		for (const box of placed) {
			expect(overlaps(boxOf(box), frame.obstacles[0]!)).toBe(false);
		}
	});

	it('leaves out a label too large for the stage, and a request without a direction', () => {
		expect(
			placeIndicators([request('a', 1, 0, { width: 400, height: 44 })], {
				width: 320,
				height: 500,
				obstacles: []
			})
		).toEqual([]);
		expect(placeIndicators([{ slug: 'b', dx: 0, dy: 0, ...LABEL }], DESKTOP)).toEqual([]);
		expect(placeIndicators([{ slug: 'c', dx: Number.NaN, dy: 1, ...LABEL }], DESKTOP)).toEqual([]);
	});

	it('answers the same input with the same places', () => {
		const frame: PlacementFrame = {
			...DESKTOP,
			obstacles: [{ left: 880, top: 0, right: 960, bottom: 320 }]
		};
		const requests = [request('a', 1, -0.2), request('b', 1, -0.1), request('c', -1, 0.4)];

		expect(placeIndicators(requests, frame)).toEqual(placeIndicators(requests, frame));
	});

	describe('on a 320 px phone stage with its controls', () => {
		// The controls as the stage lays them out at 320 × 360: zoom and help on the left, the
		// toolbar down the right, the compass and its readout, the scale bar and the credits.
		const phone: PlacementFrame = {
			width: 320,
			height: 360,
			obstacles: [
				{ left: 10, top: 10, right: 54, bottom: 158 },
				{ left: 266, top: 10, right: 310, bottom: 270 },
				{ left: 206, top: 248, right: 314, bottom: 292 },
				{ left: 5, top: 280, right: 110, bottom: 302 },
				{ left: 0, top: 330, right: 230, bottom: 360 }
			]
		};
		const compact = { width: 132, height: 44 };

		it('places three indicators clear of every control, each other and the stage edge', () => {
			const requests = [
				request('right', 1, 0, compact),
				request('left', -1, 0.1, compact),
				request('also-right', 1, 0.1, compact)
			];

			const placed = placeIndicators(requests, phone);
			const boxes = placed.map((box) => boxOf(box, compact));

			expect(placed.map((box) => box.slug)).toContain('right');
			for (const [index, box] of boxes.entries()) {
				expect(box.left).toBeGreaterThanOrEqual(EDGE_INSET_PX);
				expect(box.right).toBeLessThanOrEqual(320 - EDGE_INSET_PX);
				expect(box.top).toBeGreaterThanOrEqual(EDGE_INSET_PX);
				expect(box.bottom).toBeLessThanOrEqual(360 - EDGE_INSET_PX);
				for (const obstacle of phone.obstacles) {
					expect(overlaps(box, obstacle)).toBe(false);
				}
				for (const other of boxes.slice(index + 1)) {
					expect(overlaps(box, other)).toBe(false);
				}
			}
		});
	});
});
