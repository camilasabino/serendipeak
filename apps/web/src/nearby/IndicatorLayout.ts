import type { ScreenBox } from '../stage/globe/atlasMarkers';
import { summitMarkerFootprint } from '../stage/globe/marker';
import {
	UNKNOWN_SIGHTING,
	VIEW_HYSTERESIS_PX,
	placeInView,
	type SummitSightings
} from '../stage/globe/summitSighting';
import { overSilhouette, placeBearings, type BearingRequest } from './placeBearings';
import { placeIndicators, type Edge, type IndicatorRequest } from './placeIndicators';
import { placeMarkers, type LabelOffset, type MarkerRequest } from './placeMarkers';

/** A nearby mountain off screen: a chip at the edge it lies past, with an arrow toward it. */
export interface EdgePosition {
	mode: 'edge';
	left: number;
	top: number;
	edge: Edge;
	/** The arrow's angle, clockwise from pointing right, toward the summit's true direction. */
	angleDegrees: number;
}

/** A nearby mountain in view: a disc on its summit, named where there is room. */
export interface SummitPosition {
	mode: 'summit';
	x: number;
	y: number;
	label: LabelOffset | undefined;
}

/**
 * A nearby mountain in the frame that the globe's curve or terrain hides: a chip over the column of
 * its horizontal bearing, in the sky above where the level line in that bearing meets the stage. It says which way the summit lies, never that it stands where the chip is.
 */
export interface BearingPosition {
	mode: 'bearing';
	left: number;
	top: number;
	leaderX: number;
	leaderLength: number;
	leader: 'down';
}

export type MarkPosition = EdgePosition | SummitPosition | BearingPosition;

/**
 * Why a nearby mountain is not shown. `unreliable`: no direction to it can be trusted, as straight
 * behind the camera, or for a hidden summit nearly straight below it. `covered`: it is in view
 * under a control or another marker. `no-room`: its chip has no free place, at its edge or along
 * its bearing.
 */
export type HiddenReason = 'unreliable' | 'covered' | 'no-room';

export interface MarkSizes {
	/** The chip an off-screen or hidden mountain is shown with. */
	chip: { width: number; height: number };
	/** The name and elevation label of a summit in view. */
	label: { width: number; height: number };
}

/** What the layout reads from and writes to the page; the DOM in the browser, a fake in tests. */
export interface IndicatorSurface {
	/** The marks' sizes as laid out now, shown or not. */
	sizes(slug: string): MarkSizes | undefined;
	/** The stage's controls and credits, relative to the stage. */
	obstacles(): ScreenBox[];
	rootFontPixels(): number;
	/** The mountain whose mark holds keyboard focus. */
	focused(): string | undefined;
	show(slug: string, position: MarkPosition): void;
	/** Takes the mark away; `reason` says why, and is left out when nothing was working it out. */
	hide(slug: string, reason: HiddenReason | undefined): void;
	/** Called when the number of marks shown changes. */
	shownCount(count: number): void;
}

const SAME_PX = 0.5;
const SAME_DEGREES = 0.5;

/**
 * Lays out one mark per nearby mountain over the stage from the latest sightings: a disc and name
 * on the summit while it is in view and can be seen, a chip on its bearing while it is in the
 * frame but hidden by the horizon or terrain, a chip at the edge it lies past while it is off
 * screen. A hidden summit whose level bearing leaves the frame, as under a camera looking steeply
 * down, is pointed to from the edge that bearing leaves through. Markers are placed first, as they
 * cannot move, then bearing chips, which move only along their column, then edge chips. Reads
 * everything it needs first and writes after, and only what changed: a mark still where it was is
 * not touched, so a camera at rest costs nothing and a drag costs a transform per moving mark.
 *
 * A reading for another list of mountains, as one taken before a navigation, shows nothing, and
 * so does no reading. Each mountain remembers whether it was off screen, so the margin that keeps a
 * mark from switching back and forth on the edge applies per mountain. The mark that holds keyboard
 * focus is never taken away from under it: it stays where it last was until focus leaves.
 */
export class IndicatorLayout {
	private sightings: SummitSightings | undefined;
	private readonly offscreen = new Set<string>();
	/** The hidden summits whose bearing was last pointed to from an edge. */
	private readonly bearingOffscreen = new Set<string>();
	/** The hidden summits whose bearing is in the frame but has no sky for a chip, last pointed to from an edge. */
	private readonly bearingNoSky = new Set<string>();
	private readonly applied = new Map<string, MarkPosition>();
	private readonly hidden = new Map<string, HiddenReason>();
	private released = false;

	/** `slugs` in priority order, nearest mountain first. */
	constructor(
		private readonly slugs: readonly string[],
		private readonly surface: IndicatorSurface
	) {}

	update(sightings: SummitSightings | undefined): void {
		this.sightings = sightings;
		this.layout();
	}

	/** Lays out the latest reading again, after the labels, the controls or the focus changed. */
	relayout(): void {
		this.layout();
	}

	release(): void {
		this.released = true;
		this.apply(new Map(), new Map());
	}

	private layout(): void {
		if (this.released) {
			return;
		}

		const sightings = this.sightings;
		if (!sightings || !this.covers(sightings)) {
			this.offscreen.clear();
			this.bearingOffscreen.clear();
			this.bearingNoSky.clear();
			this.apply(new Map(), new Map());
			return;
		}

		const { viewport } = sightings;
		const reasons = new Map<string, HiddenReason>();
		const edges: IndicatorRequest[] = [];
		const summits: MarkerRequest[] = [];
		const bearings: BearingRequest[] = [];
		for (const { slug, sighting, concealed, bearing } of sightings.nearby) {
			const placement = placeInView(sighting, viewport, this.offscreen.has(slug));
			if (placement.kind === 'unknown') {
				this.offscreen.delete(slug);
				this.bearingOffscreen.delete(slug);
				reasons.set(slug, 'unreliable');
				continue;
			}

			const sizes = this.surface.sizes(slug);
			if (placement.kind === 'offscreen') {
				this.offscreen.add(slug);
				this.bearingOffscreen.delete(slug);
				if (sizes) {
					edges.push({ slug, dx: placement.dx, dy: placement.dy, ...sizes.chip });
				}
				continue;
			}

			this.offscreen.delete(slug);
			if (!concealed && sighting.kind === 'ahead') {
				this.bearingOffscreen.delete(slug);
				if (sizes) {
					summits.push({ slug, x: sighting.x, y: sighting.y, ...sizes.label });
				}
				continue;
			}

			const level = placeInView(
				bearing ?? UNKNOWN_SIGHTING,
				viewport,
				this.bearingOffscreen.has(slug)
			);
			if (level.kind === 'unknown') {
				this.bearingOffscreen.delete(slug);
				reasons.set(slug, 'unreliable');
				continue;
			}
			if (level.kind === 'offscreen') {
				this.bearingOffscreen.add(slug);
				if (sizes) {
					edges.push({ slug, dx: level.dx, dy: level.dy, ...sizes.chip });
				}
				continue;
			}
			this.bearingOffscreen.delete(slug);
			if (sizes && bearing?.kind === 'ahead') {
				bearings.push({
					slug,
					x: bearing.x,
					y: bearing.y,
					terrainMargin: this.bearingNoSky.has(slug) ? VIEW_HYSTERESIS_PX : 0,
					...sizes.chip
				});
			}
		}

		const obstacles = this.surface.obstacles();
		const { presented } = sightings;
		if (presented.kind === 'ahead') {
			obstacles.push(
				summitMarkerFootprint(presented, viewport.width, this.surface.rootFontPixels())
			);
		}

		const positions = new Map<string, MarkPosition>();
		for (const marker of placeMarkers(summits, { ...viewport, obstacles })) {
			positions.set(marker.slug, {
				mode: 'summit',
				x: marker.x,
				y: marker.y,
				label: marker.label
			});
			obstacles.push(...marker.boxes);
		}
		for (const { slug } of summits) {
			if (!positions.has(slug)) {
				reasons.set(slug, 'covered');
			}
		}

		const summit = presented.kind === 'ahead' ? { x: presented.x, y: presented.y } : undefined;
		for (const placed of placeBearings(bearings, { ...viewport, obstacles, summit })) {
			positions.set(placed.slug, {
				mode: 'bearing',
				left: Math.round(placed.left),
				top: Math.round(placed.top),
				leaderX: Math.round(placed.leaderX),
				leaderLength: Math.round(placed.leaderLength),
				leader: placed.leader
			});
			obstacles.push(placed.box);
		}
		for (const request of bearings) {
			if (positions.has(request.slug)) {
				this.bearingNoSky.delete(request.slug);
				continue;
			}

			// No sky at its bearing, which is inside the frame: point straight ahead from the top
			// edge, over the same column, rather than along a ray from the centre that would carry
			// the chip to a side.
			this.bearingNoSky.add(request.slug);
			const { x, slug, width, height } = request;
			edges.push({ slug, dx: 0, dy: -1, width, height, column: x });
		}
		for (const slug of this.bearingNoSky) {
			if (!bearings.some((request) => request.slug === slug)) {
				this.bearingNoSky.delete(slug);
			}
		}

		const directions = new Map(edges.map((request) => [request.slug, request]));
		for (const box of placeIndicators(edges, { ...viewport, obstacles })) {
			const { dx, dy, width, height, column } = directions.get(box.slug)!;
			// A pinned chip pushed down past the controls must still stay off the presented mountain.
			const footprint = {
				left: box.left,
				top: box.top,
				right: box.left + width,
				bottom: box.top + height
			};
			if (column !== undefined && overSilhouette(footprint, summit, 0)) {
				continue;
			}
			positions.set(box.slug, {
				mode: 'edge',
				left: Math.round(box.left),
				top: Math.round(box.top),
				edge: box.edge,
				angleDegrees: (Math.atan2(dy, dx) * 180) / Math.PI
			});
		}
		for (const { slug } of edges) {
			if (!positions.has(slug)) {
				reasons.set(slug, 'no-room');
			}
		}

		this.apply(positions, reasons);
	}

	private covers({ nearby }: SummitSightings): boolean {
		return (
			nearby.length === this.slugs.length &&
			nearby.every((entry, index) => entry.slug === this.slugs[index])
		);
	}

	private apply(
		positions: Map<string, MarkPosition>,
		reasons: ReadonlyMap<string, HiddenReason>
	): void {
		const focused = this.surface.focused();
		let shownCount = 0;
		for (const slug of this.slugs) {
			const shown = this.applied.get(slug);
			// A mark under keyboard focus stays where it was rather than vanish with focus on it.
			const held = slug === focused && !this.released ? shown : undefined;
			const next = positions.get(slug) ?? held;

			if (next) {
				shownCount += 1;
				this.hidden.delete(slug);
				if (!shown || !samePosition(shown, next)) {
					this.surface.show(slug, next);
					this.applied.set(slug, next);
				}
				continue;
			}

			const reason = reasons.get(slug);
			if (shown || this.hidden.get(slug) !== reason) {
				this.applied.delete(slug);
				if (reason) {
					this.hidden.set(slug, reason);
				} else {
					this.hidden.delete(slug);
				}
				this.surface.hide(slug, reason);
			}
		}

		this.surface.shownCount(shownCount);
	}
}

function samePosition(a: MarkPosition, b: MarkPosition): boolean {
	if (a.mode === 'edge' && b.mode === 'edge') {
		const turn = Math.abs(a.angleDegrees - b.angleDegrees) % 360;

		return (
			a.edge === b.edge &&
			Math.abs(a.left - b.left) < SAME_PX &&
			Math.abs(a.top - b.top) < SAME_PX &&
			Math.min(turn, 360 - turn) < SAME_DEGREES
		);
	}
	if (a.mode === 'bearing' && b.mode === 'bearing') {
		return (
			a.leader === b.leader &&
			Math.abs(a.left - b.left) < SAME_PX &&
			Math.abs(a.top - b.top) < SAME_PX &&
			Math.abs(a.leaderX - b.leaderX) < SAME_PX &&
			Math.abs(a.leaderLength - b.leaderLength) < SAME_PX
		);
	}
	if (a.mode === 'summit' && b.mode === 'summit') {
		return (
			Math.abs(a.x - b.x) < SAME_PX && Math.abs(a.y - b.y) < SAME_PX && sameLabel(a.label, b.label)
		);
	}

	return false;
}

function sameLabel(a: LabelOffset | undefined, b: LabelOffset | undefined): boolean {
	return a === undefined || b === undefined
		? a === b
		: Math.abs(a.dx - b.dx) < SAME_PX && Math.abs(a.dy - b.dy) < SAME_PX;
}
