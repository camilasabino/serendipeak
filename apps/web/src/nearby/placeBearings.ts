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
	/** Extra reach, in pixels, added to the presented mountain's silhouette for this chip. */
	terrainMargin?: number;
}

export interface BearingBox {
	slug: string;
	left: number;
	top: number;
	/** The leader from the chip to its bearing point: where it leaves the chip, and its length. */
	leaderX: number;
	leaderLength: number;
	/** The chip always stands above its bearing point, in the sky over the skyline. */
	leader: 'down';
	/** What the chip takes on the stage, for whatever is placed after it to keep clear of. */
	box: ScreenBox;
}

export interface BearingFrame {
	width: number;
	height: number;
	/** The stage's controls and credits, the presented summit's marker and the summit markers. */
	obstacles: readonly ScreenBox[];
	/** Where the presented summit projects, when it is in front of the camera. */
	summit?: { x: number; y: number };
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
/**
 * The presented mountain's silhouette as seen from the stage: a wedge widening below its summit.
 * Its terrain is not sampled; what matters is that a chip over that wedge reads as a label on the
 * presented mountain, so the wedge errs wide. `SILHOUETTE_BASE_PX` is its half-width at the summit
 * and `SILHOUETTE_SLOPE` the half-width it gains per pixel descended.
 */
const SILHOUETTE_BASE_PX = 24;
const SILHOUETTE_SLOPE = 1;
/** How far in from the chip's ends its leader stays, clear of the rounded corners. */
const LEADER_END_PX = 14;

/**
 * Places one chip per hidden summit, centred over the column of its bearing. A chip only ever moves up and down that column: a sideways move would
 * point to another bearing. It takes the nearest free place above the point, in the sky over the
 * skyline, and never below it, where it would sit on terrain. Nor does it take a place over the
 * presented mountain's silhouette, or for a bearing that falls inside it: that chip would read as
 * a label on the presented mountain. A chip near a side of the stage is slid inside it.
 * One with no such place within reach is left out, for the caller to point to from an edge, rather
 * than overlap a control, a marker, a chip placed before it or the presented mountain.
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

	for (const { slug, x, y, width, height, terrainMargin } of requests) {
		if (
			!Number.isFinite(x) ||
			!Number.isFinite(y) ||
			overSilhouette(boxAt(x, y, 0, 0), frame.summit, terrainMargin ?? 0) ||
			!(width > 0) ||
			!(height > 0) ||
			width > inner.right - inner.left
		) {
			continue;
		}

		const left = clamp(x - width / 2, inner.left, inner.right - width);
		const leaderX = clamp(x - left, Math.min(LEADER_END_PX, width / 2), width - LEADER_END_PX);
		const margin = terrainMargin ?? 0;
		const free = (box: ScreenBox) =>
			within(box, inner) &&
			!overSilhouette(box, frame.summit, margin) &&
			!blocked.some((other) => overlaps(box, other)) &&
			!placed.some((other) => overlaps(box, grow(other.box, CLEARANCE_PX)));
		const spot = findSpot(maxShift, (shift) => {
			const box = boxAt(left, y - MIN_LEADER_PX - shift - height, width, height);
			return free(box) ? box : undefined;
		});
		if (spot) {
			placed.push({
				slug,
				left,
				top: spot.box.top,
				leaderX,
				leaderLength: MIN_LEADER_PX + spot.shift,
				leader: 'down',
				box: spot.box
			});
		}
	}

	return placed;
}

/** The nearest free place above the bearing point, trying each step out to `maxShift`. */
function findSpot(
	maxShift: number,
	boxAtShift: (shift: number) => ScreenBox | undefined
): { shift: number; box: ScreenBox } | undefined {
	for (let shift = 0; shift <= maxShift; shift += STEP_PX) {
		const box = boxAtShift(shift);
		if (box) {
			return { shift, box };
		}
	}

	return undefined;
}

/** Whether a box reaches into the wedge below the presented summit, widest at the box's bottom. */
export function overSilhouette(
	box: ScreenBox,
	summit: BearingFrame['summit'],
	margin: number
): boolean {
	if (!summit || box.bottom < summit.y) {
		return false;
	}

	const reach = SILHOUETTE_BASE_PX + margin + SILHOUETTE_SLOPE * (box.bottom - summit.y);

	return box.left < summit.x + reach && box.right > summit.x - reach;
}

function boxAt(left: number, top: number, width: number, height: number): ScreenBox {
	return { left, top, right: left + width, bottom: top + height };
}
