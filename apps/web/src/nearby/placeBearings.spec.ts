import { describe, expect, it } from 'vitest';
import type { ScreenBox } from '../stage/globe/atlasMarkers';
import { placeBearings, type BearingBox, type BearingRequest } from './placeBearings';

const FRAME = { width: 1440, height: 900, obstacles: [] as ScreenBox[] };
const CHIP = { width: 130, height: 44 };

const request = (slug: string, x: number, y: number): BearingRequest => ({ slug, x, y, ...CHIP });

function overlaps(a: ScreenBox, b: ScreenBox): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Where the leader ends: the bearing point it refers to. */
function leaderEnd(box: BearingBox) {
	return {
		x: box.left + box.leaderX,
		y: box.leader === 'down' ? box.box.bottom + box.leaderLength : box.box.top - box.leaderLength
	};
}

describe('placeBearings', () => {
	it('stands a chip over its bearing point, centred on its column, with a leader down to it', () => {
		const [box] = placeBearings([request('mont-blanc', 1030, 320)], FRAME);

		expect(box).toMatchObject({ slug: 'mont-blanc', left: 965, leader: 'down', leaderX: 65 });
		expect(box!.box.bottom).toBeLessThan(320);
		expect(leaderEnd(box!)).toEqual({ x: 1030, y: 320 });
	});

	it('stacks chips on nearly the same bearing along their columns, never sideways, nearest first', () => {
		const placed = placeBearings(
			[
				request('mont-blanc', 1030, 320),
				request('matterhorn', 1068, 322),
				request('eiger', 992, 324)
			],
			FRAME
		);

		expect(placed.map((box) => box.slug)).toEqual(['mont-blanc', 'matterhorn', 'eiger']);
		for (const box of placed) {
			expect(box.left).toBe(Math.round(leaderEnd(box).x - CHIP.width / 2));
		}
		expect(placed.map(leaderEnd)).toEqual([
			{ x: 1030, y: 320 },
			{ x: 1068, y: 322 },
			{ x: 992, y: 324 }
		]);
		for (const [index, box] of placed.entries()) {
			for (const other of placed.slice(index + 1)) {
				expect(overlaps(box.box, other.box)).toBe(false);
			}
		}
		expect(placed[0]!.leaderLength).toBeLessThan(placed[1]!.leaderLength);
	});

	it('hangs a chip below its point when there is no room above it', () => {
		const [box] = placeBearings([request('mont-blanc', 700, 40)], FRAME);

		expect(box?.leader).toBe('up');
		expect(box!.box.top).toBeGreaterThan(40);
		expect(leaderEnd(box!)).toEqual({ x: 700, y: 40 });
	});

	it('keeps clear of controls and markers, and slides inside the stage near a side with its leader on the column', () => {
		const presented: ScreenBox = { left: 600, top: 200, right: 840, bottom: 300 };
		const [cleared] = placeBearings([request('k', 720, 320)], { ...FRAME, obstacles: [presented] });
		const [atSide] = placeBearings([request('side', 1420, 400)], FRAME);

		expect(overlaps(cleared!.box, presented)).toBe(false);
		expect(leaderEnd(cleared!).x).toBe(720);
		expect(atSide!.box.right).toBeLessThanOrEqual(1432);
		expect(atSide!.leaderX).toBeLessThanOrEqual(CHIP.width - 14);
	});

	it('leaves a chip out rather than overlap anything when its column is full', () => {
		const wall: ScreenBox = { left: 0, top: 0, right: 1440, bottom: 900 };

		expect(
			placeBearings([request('mont-blanc', 1030, 320)], { ...FRAME, obstacles: [wall] })
		).toEqual([]);
		expect(placeBearings([{ ...request('wide', 700, 300), width: 1500 }], FRAME)).toEqual([]);
		expect(placeBearings([request('lost', Number.NaN, 300)], FRAME)).toEqual([]);
	});
});
