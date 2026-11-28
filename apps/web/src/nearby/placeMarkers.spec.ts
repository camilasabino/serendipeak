import { describe, expect, it } from 'vitest';
import type { ScreenBox } from '../stage/globe/atlasMarkers';
import {
	MARKER_DISC_RADIUS_PX,
	placeMarkers,
	type MarkerFrame,
	type MarkerRequest
} from './placeMarkers';

const FRAME: MarkerFrame = { width: 960, height: 600, obstacles: [] };
const request = (slug: string, x: number, y: number, width = 110, height = 32): MarkerRequest => ({
	slug,
	x,
	y,
	width,
	height
});

function labelBox(
	x: number,
	y: number,
	label: { dx: number; dy: number },
	width = 110,
	height = 32
) {
	return {
		left: x + label.dx,
		top: y + label.dy,
		right: x + label.dx + width,
		bottom: y + label.dy + height
	};
}

const overlaps = (a: ScreenBox, b: ScreenBox) =>
	a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('placeMarkers', () => {
	it('stands each disc exactly on its summit and puts the name above it, centred', () => {
		const [marker] = placeMarkers([request('a', 400, 300)], FRAME);

		expect(marker).toMatchObject({ slug: 'a', x: 400, y: 300 });
		expect(marker!.label!.dx).toBe(-55);
		expect(marker!.label!.dy).toBeLessThan(-MARKER_DISC_RADIUS_PX - 32 + 1);
	});

	it('puts the name below a summit near the top of the stage', () => {
		const [marker] = placeMarkers([request('a', 400, 30)], FRAME);

		expect(marker!.label!.dy).toBeGreaterThan(0);
	});

	it('slides the name along the stage to stay inside it, still over its summit', () => {
		const [marker] = placeMarkers([request('a', 20, 300)], FRAME);

		const box = labelBox(20, 300, marker!.label!);
		expect(box.left).toBeGreaterThanOrEqual(8);
		expect(box.left <= 20 && 20 <= box.right).toBe(true);
	});

	it('puts the name beside a summit when above and below are taken', () => {
		const frame = {
			...FRAME,
			obstacles: [
				{ left: 0, top: 0, right: 960, bottom: 270 },
				{ left: 0, top: 330, right: 960, bottom: 600 }
			]
		};
		const [marker] = placeMarkers([request('a', 400, 300, 110, 20)], frame);

		expect(marker!.label!.dx).toBeGreaterThan(0);
	});

	it('keeps the disc without a name when no place beside it is free', () => {
		const frame = {
			...FRAME,
			obstacles: [
				{ left: 330, top: 0, right: 470, bottom: 600 },
				{ left: 0, top: 0, right: 960, bottom: 280 },
				{ left: 0, top: 320, right: 960, bottom: 600 }
			]
		};
		const marked = placeMarkers([request('a', 480, 300)], {
			...frame,
			obstacles: [...frame.obstacles, { left: 490, top: 0, right: 960, bottom: 600 }]
		});

		expect(marked).toHaveLength(1);
		expect(marked[0]!.label).toBeUndefined();
	});

	it('leaves out a summit whose disc would sit on a control or on a marker placed before it', () => {
		const marked = placeMarkers(
			[request('a', 400, 300), request('b', 404, 304), request('c', 100, 100)],
			{ ...FRAME, obstacles: [{ left: 90, top: 90, right: 110, bottom: 110 }] }
		);

		expect(marked.map((marker) => marker.slug)).toEqual(['a']);
	});

	it('never lets the name of a later marker cover an earlier one, and the earlier keeps its place', () => {
		const first = placeMarkers([request('a', 400, 300)], FRAME)[0]!;
		const marked = placeMarkers([request('a', 400, 300), request('b', 430, 320)], FRAME);

		expect(marked[0]).toEqual(first);
		const a = labelBox(400, 300, marked[0]!.label!);
		const b = marked[1]!.label ? labelBox(430, 320, marked[1]!.label) : undefined;
		if (b) {
			expect(overlaps(a, b)).toBe(false);
		}
	});

	it('hands back what each marker takes, for whatever is placed after it', () => {
		const [marker] = placeMarkers([request('a', 400, 300)], FRAME);

		expect(marker!.boxes).toHaveLength(2);
		expect(marker!.boxes[0]!.left).toBeLessThan(400 - MARKER_DISC_RADIUS_PX);
	});

	it('is deterministic and ignores a summit with no position', () => {
		const requests = [request('a', 400, 300), request('b', Number.NaN, 10), request('c', 700, 200)];

		expect(placeMarkers(requests, FRAME)).toEqual(placeMarkers(requests, FRAME));
		expect(placeMarkers(requests, FRAME).map((marker) => marker.slug)).toEqual(['a', 'c']);
	});
});
