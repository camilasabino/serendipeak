import type { ScreenBox } from '../stage/globe/atlasMarkers';
import { clamp, grow, overlaps, within } from './screenBoxes';
import { CLEARANCE_PX } from './placeIndicators';

/** A nearby summit in view: where it stands on the stage, and the size of the label it may carry. */
export interface MarkerRequest {
	slug: string;
	x: number;
	y: number;
	width: number;
	height: number;
}

/** Where a label's top left corner stands, relative to its summit. */
export interface LabelOffset {
	dx: number;
	dy: number;
}

export interface MarkerBox {
	slug: string;
	x: number;
	y: number;
	/** Undefined when no place beside the summit was free: the summit is marked without a name. */
	label: LabelOffset | undefined;
	/** What the marker takes on the stage, for whatever is placed after it to keep clear of. */
	boxes: ScreenBox[];
}

export interface MarkerFrame {
	width: number;
	height: number;
	/** The stage's controls and credits, and the presented summit's marker. */
	obstacles: readonly ScreenBox[];
}

/** Half the width of the disc marking a summit. */
export const MARKER_DISC_RADIUS_PX = 6;
/** From the disc's edge to its label. */
const LABEL_GAP_PX = 4;
/** How far a label keeps from the stage's edges. */
const LABEL_INSET_PX = 8;
/** The clear space kept around a disc, so two markers that nearly touch are not read as one. */
const DISC_CLEARANCE_PX = 2;

/**
 * Marks each summit in view where it stands, with its name beside it. A summit's disc is drawn
 * exactly at its place or not at all: one that would sit on a control, on the presented summit's
 * marker or on a disc already placed is left out. Its label takes the first free place among above,
 * below, to the right and to the left, shifted along the stage just enough to stay inside it; with
 * none free, the disc stands alone.
 *
 * Requests are placed in the order given, which is their priority, nearest mountain first, and an
 * earlier marker is never moved for a later one, so the result depends on the input only. For n
 * requests and m obstacles that is O(n · (m + n)) box tests.
 */
export function placeMarkers(requests: readonly MarkerRequest[], frame: MarkerFrame): MarkerBox[] {
	const inner: ScreenBox = {
		left: LABEL_INSET_PX,
		top: LABEL_INSET_PX,
		right: frame.width - LABEL_INSET_PX,
		bottom: frame.height - LABEL_INSET_PX
	};
	const clearOfLabels = frame.obstacles.map((box) => grow(box, CLEARANCE_PX));
	const placed: MarkerBox[] = [];
	const taken: ScreenBox[] = [];

	for (const { slug, x, y, width, height } of requests) {
		if (!Number.isFinite(x) || !Number.isFinite(y)) {
			continue;
		}

		const disc = grow({ left: x, top: y, right: x, bottom: y }, MARKER_DISC_RADIUS_PX);
		const discTaken = grow(disc, DISC_CLEARANCE_PX);
		if (
			frame.obstacles.some((box) => overlaps(disc, box)) ||
			taken.some((box) => overlaps(discTaken, box))
		) {
			continue;
		}

		const boxes = [discTaken];
		let label: LabelOffset | undefined;
		if (width > 0 && height > 0) {
			for (const candidate of labelCandidates(x, y, width, height, inner)) {
				const box = boxOf(candidate, width, height);
				if (
					within(box, inner) &&
					!clearOfLabels.some((other) => overlaps(box, other)) &&
					!taken.some((other) => overlaps(box, other)) &&
					!overlaps(box, discTaken)
				) {
					label = { dx: candidate.left - x, dy: candidate.top - y };
					boxes.push(grow(box, CLEARANCE_PX));
					break;
				}
			}
		}

		placed.push({ slug, x, y, label, boxes });
		taken.push(...boxes);
	}

	return placed;
}

interface Corner {
	left: number;
	top: number;
}

function labelCandidates(
	x: number,
	y: number,
	width: number,
	height: number,
	inner: ScreenBox
): Corner[] {
	const reach = MARKER_DISC_RADIUS_PX + LABEL_GAP_PX;
	// Centred on the disc, then slid back inside the stage while still over it.
	const centered = clamp(x - width / 2, inner.left, inner.right - width);
	const overDisc = centered <= x && x <= centered + width;

	return [
		...(overDisc ? [{ left: centered, top: y - reach - height }] : []),
		...(overDisc ? [{ left: centered, top: y + reach }] : []),
		{ left: x + reach, top: y - height / 2 },
		{ left: x - reach - width, top: y - height / 2 }
	];
}

function boxOf({ left, top }: Corner, width: number, height: number): ScreenBox {
	return { left, top, right: left + width, bottom: top + height };
}
