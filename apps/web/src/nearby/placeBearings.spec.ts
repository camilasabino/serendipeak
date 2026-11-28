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
		y: box.box.bottom + box.leaderLength
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

	it('never hangs a chip below its point: with no room above, it is left out', () => {
		expect(placeBearings([request('mont-blanc', 700, 40)], FRAME)).toEqual([]);
	});

	describe('over the presented mountain', () => {
		const summit = { x: 720, y: 400 };

		it('leaves out a chip whose bearing falls inside the silhouette below the summit', () => {
			expect(placeBearings([request('k', 745, 470)], { ...FRAME, summit })).toEqual([]);
			expect(placeBearings([request('k', 745, 470)], FRAME)).toHaveLength(1);
		});

		it('lifts a chip that would reach into the silhouette to the summit’s level, still on its column', () => {
			// The bearing is clear of the wedge, but the chip, 65 px either side of its column, is not.
			const [chip] = placeBearings([request('k', 780, 410)], { ...FRAME, summit });

			expect(chip!.box.bottom).toBeLessThanOrEqual(summit.y);
			expect(leaderEnd(chip!)).toEqual({ x: 780, y: 410 });
		});

		it('still stands over a bearing in the sky above the summit, or clear of the wedge to its side', () => {
			const [above] = placeBearings([request('k', 720, 300)], { ...FRAME, summit });
			const [aside] = placeBearings([request('k', 1100, 470)], { ...FRAME, summit });

			expect(above?.box.bottom).toBeLessThan(300);
			expect(aside?.left).toBe(1035);
		});

		it('widens the silhouette by a chip’s own margin', () => {
			const at = (terrainMargin: number) =>
				placeBearings([{ ...request('k', 1000, 420), terrainMargin }], { ...FRAME, summit });

			expect(at(0)).toHaveLength(1);
			expect(at(300)).toEqual([]);
		});

		it('ignores a presented summit that is not in front of the camera', () => {
			expect(placeBearings([request('k', 745, 470)], { ...FRAME, summit: undefined })).toHaveLength(
				1
			);
		});
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
