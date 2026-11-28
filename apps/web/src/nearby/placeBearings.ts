import type { ScreenBox } from '../stage/globe/atlasMarkers';
import { clamp, grow, overlaps, within } from './screenBoxes';
import { CLEARANCE_PX } from './placeIndicators';

/**
 * A hidden summit in the frame: the point where the level line in its bearing meets the stage,
 * and the size of the chip that names it.
 */
export interface BearingRequest {
	slug: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface BearingBox {
	slug: string;
	left: number;
	top: number;
	/** The leader from the chip to its bearing point: where it leaves the chip, and its length. */
	leaderX: number;
	leaderLength: number;
	/** `down` when the chip stands above its bearing point, `up` when below it. */
	leader: 'down' | 'up';
	/** What the chip takes on the stage, for whatever is placed after it to keep clear of. */
	box: ScreenBox;
}

export interface BearingFrame {
	width: number;
	height: number;
	/** The stage's controls and credits, the presented summit's marker and the summit markers. */
	obstacles: readonly ScreenBox[];
}

/** How far a chip keeps from the stage's edges. */
const INSET_PX = 8;
/** The shortest gap, so the chip never sits on the point it refers to. */
const MIN_LEADER_PX = 10;
/** The step a chip moves along its column when its place is taken. */
const STEP_PX = 4;
/**
 * How far a chip may move along its column, as a share of the stage's height, and never less than
 * the minimum: room for three chips stacked on one bearing on a desktop stage.
 */
const MAX_SHIFT_SHARE = 0.25;
const MIN_MAX_SHIFT_PX = 96;
/** How far in from the chip's ends its leader stays, clear of the rounded corners. */
const LEADER_END_PX = 14;

/**
 * Places one chip per hidden summit, centred over the column of its bearing. A chip only ever moves up and down that column: a sideways move would
 * point to another bearing. It takes the nearest free place above the point, in the sky over the
 * skyline, and only with none there the nearest below it, over terrain the summit is not on; a
 * chip near a side of the stage is slid inside it.
 * One with no free place within reach is left out rather than overlap a control, a marker or a
 * chip placed before it.
 *
 * Requests are placed in the order given, which is their priority, nearest mountain first. For n
 * requests and m obstacles, each tries O(shift / step) places, each checked against m + n boxes.
 */
export function placeBearings(
	requests: readonly BearingRequest[],
	frame: BearingFrame
): BearingBox[] {
	const inner: ScreenBox = {
		left: INSET_PX,
		top: INSET_PX,
		right: frame.width - INSET_PX,
		bottom: frame.height - INSET_PX
	};
	const blocked = frame.obstacles.map((box) => grow(box, CLEARANCE_PX));
	const maxShift = Math.max(MIN_MAX_SHIFT_PX, MAX_SHIFT_SHARE * frame.height);
	const placed: BearingBox[] = [];

	for (const { slug, x, y, width, height } of requests) {
		if (
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			!(width > 0) ||
			!(height > 0) ||
			width > inner.right - inner.left
		) {
			continue;
		}

		const left = clamp(x - width / 2, inner.left, inner.right - width);
		const leaderX = clamp(x - left, Math.min(LEADER_END_PX, width / 2), width - LEADER_END_PX);
		const free = (box: ScreenBox) =>
			within(box, inner) &&
			!blocked.some((other) => overlaps(box, other)) &&
			!placed.some((other) => overlaps(box, grow(other.box, CLEARANCE_PX)));
		const spot =
			findSpot('down', maxShift, (shift) => {
				const box = boxAt(left, y - MIN_LEADER_PX - shift - height, width, height);
				return free(box) ? box : undefined;
			}) ??
			findSpot('up', maxShift, (shift) => {
				const box = boxAt(left, y + MIN_LEADER_PX + shift, width, height);
				return free(box) ? box : undefined;
			});
		if (spot) {
			placed.push({
				slug,
				left,
				top: spot.box.top,
				leaderX,
				leaderLength: MIN_LEADER_PX + spot.shift,
				leader: spot.leader,
				box: spot.box
			});
		}
	}

	return placed;
}

/** The nearest free place on one side of the bearing point, trying each step out to `maxShift`. */
function findSpot(
	leader: BearingBox['leader'],
	maxShift: number,
	boxAtShift: (shift: number) => ScreenBox | undefined
): { leader: BearingBox['leader']; shift: number; box: ScreenBox } | undefined {
	for (let shift = 0; shift <= maxShift; shift += STEP_PX) {
		const box = boxAtShift(shift);
		if (box) {
			return { leader, shift, box };
		}
	}

	return undefined;
}

function boxAt(left: number, top: number, width: number, height: number): ScreenBox {
	return { left, top, right: left + width, bottom: top + height };
}
