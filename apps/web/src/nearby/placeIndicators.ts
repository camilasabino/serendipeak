import type { ScreenBox } from '../stage/globe/atlasMarkers';
import { clamp, grow, overlaps, within } from './screenBoxes';

export type Edge = 'left' | 'right' | 'top' | 'bottom';

/** An indicator to place: the way to its summit from the stage's centre, and its label's size. */
export interface IndicatorRequest {
	slug: string;
	/** A unit vector on the screen, y pointing down. */
	dx: number;
	dy: number;
	width: number;
	height: number;
}

export interface IndicatorBox {
	slug: string;
	left: number;
	top: number;
	edge: Edge;
}

export interface PlacementFrame {
	width: number;
	height: number;
	/** What indicators must keep clear of: the stage's controls, its credits, the summit marker. */
	obstacles: readonly ScreenBox[];
}

/** How far every indicator stays from the stage's edge. */
export const EDGE_INSET_PX = 12;
/** The clear space kept around controls and between indicators. */
export const CLEARANCE_PX = 6;
/** The step an indicator slides along its edge when its place is taken. */
const SLIDE_STEP_PX = 4;
/**
 * How far an indicator may slide along its edge, as a share of that edge, and never less than the
 * minimum. Beyond it the label would sit too far from where its arrow points to belong to it.
 */
const MAX_SLIDE_SHARE = 0.3;
const MIN_MAX_SLIDE_PX = 48;
/** How far an indicator may be pushed inward past controls on its edge, as a share of the stage. */
const MAX_PUSH_SHARE = 0.4;

interface Candidate {
	left: number;
	top: number;
	cost: number;
}

/**
 * Places each indicator against the stage edge its direction leaves through, centred where a ray
 * from the stage's centre along that direction meets the edge, inset from it. Requests are placed
 * in the order given, which is their priority: nearest mountain first.
 *
 * An indicator whose place overlaps a control, the credits or the summit marker is pushed inward
 * past it; one that would still overlap something, or an indicator placed before it, slides along
 * the edge to the nearest free place. The cost of a place is how far it moved, along the edge plus
 * inward, and the cheapest wins, earlier candidates breaking ties, so the result depends on the
 * input only. An indicator with no free place within reach is left out rather than overlap anything.
 *
 * For n requests and m obstacles, each indicator tries O(edge / step) places, each checked against
 * the m obstacles and the indicators already placed: O(n · edge / step · (m + n)), a few thousand
 * box tests for three indicators on a large stage.
 */
export function placeIndicators(
	requests: readonly IndicatorRequest[],
	frame: PlacementFrame
): IndicatorBox[] {
	const inner: ScreenBox = {
		left: EDGE_INSET_PX,
		top: EDGE_INSET_PX,
		right: frame.width - EDGE_INSET_PX,
		bottom: frame.height - EDGE_INSET_PX
	};
	const obstacles = frame.obstacles.map((box) => grow(box, CLEARANCE_PX));
	const placed: IndicatorBox[] = [];
	const taken: ScreenBox[] = [];

	for (const request of requests) {
		const fits =
			request.width > 0 &&
			request.height > 0 &&
			request.width <= inner.right - inner.left &&
			request.height <= inner.bottom - inner.top;
		const exit = fits ? edgeExit(request.dx, request.dy, frame, inner) : undefined;
		if (!exit) {
			continue;
		}

		const spot = bestSpot(request, exit, inner, obstacles, taken);
		if (!spot) {
			continue;
		}

		placed.push({ slug: request.slug, left: spot.left, top: spot.top, edge: exit.edge });
		taken.push(grow(boxAt(spot.left, spot.top, request), CLEARANCE_PX));
	}

	return placed;
}

/** Where a ray from the stage's centre along (dx, dy) leaves the inset frame. */
function edgeExit(
	dx: number,
	dy: number,
	frame: PlacementFrame,
	inner: ScreenBox
): { edge: Edge; along: number } | undefined {
	if (!Number.isFinite(dx) || !Number.isFinite(dy) || (dx === 0 && dy === 0)) {
		return undefined;
	}

	const centerX = frame.width / 2;
	const centerY = frame.height / 2;
	const toSide =
		dx > 0 ? (inner.right - centerX) / dx : dx < 0 ? (inner.left - centerX) / dx : Infinity;
	const toEnd =
		dy > 0 ? (inner.bottom - centerY) / dy : dy < 0 ? (inner.top - centerY) / dy : Infinity;

	if (toSide <= toEnd) {
		return { edge: dx > 0 ? 'right' : 'left', along: centerY + toSide * dy };
	}

	return { edge: dy > 0 ? 'bottom' : 'top', along: centerX + toEnd * dx };
}

function bestSpot(
	request: IndicatorRequest,
	{ edge, along }: { edge: Edge; along: number },
	inner: ScreenBox,
	obstacles: readonly ScreenBox[],
	taken: readonly ScreenBox[]
): Candidate | undefined {
	const vertical = edge === 'left' || edge === 'right';
	const size = vertical ? request.height : request.width;
	const start = vertical ? inner.top : inner.left;
	const end = (vertical ? inner.bottom : inner.right) - size;
	const ideal = clamp(along - size / 2, start, end);
	const edgeLength = (vertical ? inner.bottom - inner.top : inner.right - inner.left) - size;
	const maxSlide = Math.max(MIN_MAX_SLIDE_PX, MAX_SLIDE_SHARE * edgeLength);
	const maxPush = MAX_PUSH_SHARE * (vertical ? inner.right - inner.left : inner.bottom - inner.top);

	let best: Candidate | undefined;
	const tried = new Set<number>();
	for (let step = 0; step * SLIDE_STEP_PX <= maxSlide; step += 1) {
		if (best && step * SLIDE_STEP_PX > best.cost) {
			break;
		}
		for (const sign of step === 0 ? [1] : [1, -1]) {
			const offset = clamp(ideal + sign * step * SLIDE_STEP_PX, start, end);
			if (tried.has(offset)) {
				continue;
			}
			tried.add(offset);

			const candidate = spotAt(request, edge, offset, inner, obstacles, taken, maxPush);
			if (candidate) {
				const cost = Math.abs(offset - ideal) + candidate.push;
				if (!best || cost < best.cost) {
					best = { left: candidate.left, top: candidate.top, cost };
				}
			}
		}
	}

	return best;
}

/**
 * The place at `offset` along the edge, pushed inward past every obstacle it meets, or undefined
 * when it would overlap an indicator already placed or need pushing beyond `maxPush`.
 */
function spotAt(
	request: IndicatorRequest,
	edge: Edge,
	offset: number,
	inner: ScreenBox,
	obstacles: readonly ScreenBox[],
	taken: readonly ScreenBox[],
	maxPush: number
): { left: number; top: number; push: number } | undefined {
	const { width, height } = request;

	for (let push = 0; push <= maxPush;) {
		const left =
			edge === 'left' ? inner.left + push : edge === 'right' ? inner.right - width - push : offset;
		const top =
			edge === 'top' ? inner.top + push : edge === 'bottom' ? inner.bottom - height - push : offset;
		const box = boxAt(left, top, request);
		if (!within(box, inner) || taken.some((other) => overlaps(box, other))) {
			return undefined;
		}

		const blocking = obstacles.filter((obstacle) => overlaps(box, obstacle));
		if (blocking.length === 0) {
			return { left, top, push };
		}

		// Just past the farthest-reaching obstacle in the way, measured from the edge.
		const clearedAt = Math.max(
			...blocking.map((obstacle) => {
				switch (edge) {
					case 'left':
						return obstacle.right - inner.left;
					case 'right':
						return inner.right - obstacle.left;
					case 'top':
						return obstacle.bottom - inner.top;
					case 'bottom':
						return inner.bottom - obstacle.top;
				}
			})
		);
		if (!(clearedAt > push)) {
			return undefined;
		}
		push = clearedAt;
	}

	return undefined;
}

function boxAt(left: number, top: number, { width, height }: IndicatorRequest): ScreenBox {
	return { left, top, right: left + width, bottom: top + height };
}
