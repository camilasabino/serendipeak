import { SUMMIT_MARKER_STYLE } from './marker';
import type { StageSize } from './stageFrame';

/** A mountain as the atlas draws it: where its summit stands and the name its label shows. */
export interface AtlasMarker {
	slug: string;
	name: string;
	latitude: number;
	longitude: number;
	elevationMeters: number;
}

export interface ScreenPoint {
	x: number;
	y: number;
}

/** An axis-aligned box on the canvas in CSS pixels; `top` is above `bottom`. */
export interface ScreenBox {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

/**
 * How atlas markers look at each camera distance. The scene hands these to Cesium as per-marker
 * distance properties evaluated on the GPU, so an oblique view labels the near ridge and not the
 * far one, and nothing is rebuilt as the camera moves.
 *
 * The overview sits 13,000 km or more from every marker, where points shrink and soften and no
 * label shows. Names come in from a regional distance: fully opaque up to 1,500 km, then fading out
 * over the next 60 km. Summits a few kilometres apart (Cerro Torre and Fitz Roy, Everest and Ama
 * Dablam) still overlap there until labels are decluttered on screen.
 *
 * The opaque range reaches past where a range or country filter leaves the camera on a typical
 * stage: the set is framed by its extent and the stage's aspect, so two mountains 700 km apart sit
 * at 1,000 km on a tall desktop stage and at 1,400 km on a short, wide one.
 */
export const ATLAS_MARKER_STYLE = {
	/**
	 * The dot, in CSS pixels, drawn once as a sprite in each state: a red disc,
	 * snow ring and basalt halo at the reference's atlas size (11.2 px across, as the point it
	 * replaced). Emphasis grows the disc and lays a snow glow under it; the glow is the only part of
	 * the dot that is not a press target, so a neighbour is no harder to hit.
	 */
	dot: {
		// A dedicated map colour, not the brand copper: copper sits too close to desert and rock imagery
		// to find on the globe, and red is rare in satellite imagery.
		fill: '#dc3d44',
		radius: 3.2,
		ringWidth: 1.4,
		haloWidth: 1,
		emphasizedScale: 1.25,
		glowWidth: 2.6,
		glowAlpha: 0.3
	},
	/** The dot's width at rest: the size the scene scales with distance. */
	pointPixelSize: 11.2,
	/** Full size up to this distance, shrinking linearly to `pointFarScale` at `pointFarMeters`. */
	pointNearMeters: 250_000,
	pointFarMeters: 8_000_000,
	pointFarScale: 0.85,
	/** Opaque up to this distance, fading linearly to `pointFarAlpha` at `pointFadedMeters`. */
	pointOpaqueMeters: 3_000_000,
	pointFadedMeters: 15_000_000,
	pointFarAlpha: 0.9,
	// Cesium rasterizes labels on a canvas before web fonts may have loaded, so a system face keeps
	// glyphs from being cached in a fallback, as the summit marker's label does.
	labelFont: '500 13px system-ui, sans-serif',
	labelOffsetPixels: 7,
	labelOutlinePixels: 2,
	/**
	 * Fully opaque up to this distance, fading out linearly to nothing at `labelMaxMeters`. The pass
	 * applies the ramp label by label (see `AtlasMarkers`): Cesium's own `translucencyByDistance`
	 * falls as `1 - ((d² - near²) / (far² - near²))^0.2`, which is almost all of its drop in the first
	 * few percent of the range followed by a long ghost, so no near/far pair gives a short, even fade.
	 */
	labelFullMeters: 1_500_000,
	labelMaxMeters: 1_560_000,
	// Over the globe a label this faint cannot be read, so it is dropped: it takes no screen space
	// from a legible neighbour and is not a place to press. Its marker still shows and still opens.
	labelMinAlpha: 0.25,
	/** Opacity is handed to Cesium in steps this fine, so a label is not rewritten every frame. */
	labelAlphaSteps: 20,
	// Snow text on a basalt plate and outline, as the summit pill: legible over snow, desert, ocean
	// and forest alike. Colours are the summit marker's, which marker.spec compares with the tokens.
	labelColor: SUMMIT_MARKER_STYLE.colors.snow,
	outlineColor: SUMMIT_MARKER_STYLE.colors.basalt,
	outlineAlpha: 0.9,
	/**
	 * The preview a pointer or a list row summons: the summit's pill over the one emphasized marker.
	 * It is shown at any distance, since it is a single name the reader asked for, and it claims its
	 * screen space ahead of every ordinary label.
	 */
	preview: {
		/** From the emphasized dot's edge to the pill's. */
		gapPixels: 6,
		/** The least the pill keeps from the stage's edges. */
		edgeMarginPixels: 8
	}
} as const;

export interface MarkerPresentation {
	pointPixels: number;
	pointAlpha: number;
	/** How opaque a label is at this distance, as the GPU fades it. */
	labelAlpha: number;
	/** Legible enough to be named: alpha at or above `labelMinAlpha`. */
	labelShown: boolean;
	/** Within label distance but past full legibility, fading out. */
	labelFading: boolean;
}

// The near value up to `near`, the far value beyond `far`, linear in distance between. Cesium's own
// NearFarScalar is not linear (see `labelFullMeters`), so this models what the scene draws only for
// values the pass applies itself, and approximates the ones the GPU interpolates.
function nearFar(distance: number, near: number, nearValue: number, far: number, farValue: number) {
	const t = Math.min(Math.max((distance - near) / (far - near), 0), 1);

	return nearValue + (farValue - nearValue) * t;
}

/** A label's opacity rounded to the step it is handed to Cesium in. */
export function labelOpacityStep(alpha: number): number {
	const steps = ATLAS_MARKER_STYLE.labelAlphaSteps;

	return Math.round(alpha * steps) / steps;
}

/** What a marker at this camera distance looks like, as the GPU draws it from the style above. */
export function markerPresentation(distanceMeters: number): MarkerPresentation {
	const style = ATLAS_MARKER_STYLE;
	const scale = nearFar(
		distanceMeters,
		style.pointNearMeters,
		1,
		style.pointFarMeters,
		style.pointFarScale
	);

	const labelAlpha = nearFar(distanceMeters, style.labelFullMeters, 1, style.labelMaxMeters, 0);

	return {
		pointPixels: style.pointPixelSize * scale,
		pointAlpha: nearFar(
			distanceMeters,
			style.pointOpaqueMeters,
			1,
			style.pointFadedMeters,
			style.pointFarAlpha
		),
		labelAlpha,
		labelShown: labelAlpha >= style.labelMinAlpha,
		labelFading: distanceMeters > style.labelFullMeters
	};
}

/**
 * What the scene knows about a marker from the camera's point of view. Each fact is necessary on
 * its own: a summit on the far side of the Earth still projects inside the canvas, and one behind
 * the camera can project there too.
 */
export interface MarkerSighting {
	/** In front of the camera, not behind it. */
	inFront: boolean;
	/** Not hidden by the curve of the Earth. */
	aboveHorizon: boolean;
	/** Where it lands on the canvas in CSS pixels from the top left, if it can be projected. */
	window: ScreenPoint | undefined;
}

export function isMarkerVisible(
	{ inFront, aboveHorizon, window }: MarkerSighting,
	viewport: StageSize
): boolean {
	if (!inFront || !aboveHorizon || !window) {
		return false;
	}
	const { x, y } = window;

	return x >= 0 && x <= viewport.width && y >= 0 && y <= viewport.height;
}

export interface MarkerChanges {
	added: AtlasMarker[];
	changed: AtlasMarker[];
	removed: string[];
}

export function sameAtlasMarker(a: AtlasMarker, b: AtlasMarker): boolean {
	return (
		a.slug === b.slug &&
		a.name === b.name &&
		a.latitude === b.latitude &&
		a.longitude === b.longitude &&
		a.elevationMeters === b.elevationMeters
	);
}

/**
 * Turns the markers shown into the next set, by slug. A slug listed twice keeps its first entry;
 * the index never lists one twice, and a marker must never be drawn twice.
 */
export function diffMarkers(
	current: Iterable<AtlasMarker>,
	next: readonly AtlasMarker[]
): MarkerChanges {
	const before = new Map<string, AtlasMarker>();
	for (const marker of current) {
		before.set(marker.slug, marker);
	}

	const seen = new Set<string>();
	const added: AtlasMarker[] = [];
	const changed: AtlasMarker[] = [];
	for (const marker of next) {
		if (seen.has(marker.slug)) {
			continue;
		}
		seen.add(marker.slug);

		const previous = before.get(marker.slug);
		if (!previous) {
			added.push(marker);
		} else if (!sameAtlasMarker(previous, marker)) {
			changed.push(marker);
		}
	}
	const removed = [...before.keys()].filter((slug) => !seen.has(slug));

	return { added, changed, removed };
}

export function sameAtlasMarkers(
	a: readonly AtlasMarker[] | undefined,
	b: readonly AtlasMarker[] | undefined
): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b || a.length !== b.length) {
		return false;
	}

	return a.every((marker, index) => sameAtlasMarker(marker, b[index]!));
}

/** One marker as the last visibility pass left it, for end-to-end tests. */
export interface AtlasMarkerReading {
	slug: string;
	visible: boolean;
	/** Canvas position in CSS pixels, present while visible. */
	window?: ScreenPoint;
	distanceMeters: number;
	pointPixels: number;
	labelShown: boolean;
	/** Close enough to be named, but another label won the space. The marker still shows. */
	labelSuppressed: boolean;
	/** The plate of the shown label in CSS pixels, as decluttering measured it. */
	label?: ScreenBox;
	/** How opaque the shown label is drawn, 0 to 1. */
	labelOpacity?: number;
}

export interface AtlasLayerReading {
	/** The layer is on the globe: markers set and not hidden. */
	shown: boolean;
	/** The marker the mouse rests on, emphasized, if one would open on a click. */
	hovered?: string;
	/** The marker a list row asks to be emphasized, while the pointer is not on one. */
	highlighted?: string;
	/** The preview pill on screen, with the pill's box in CSS pixels, if one is shown. */
	preview?: { slug: string; box: ScreenBox };
	/** Atlas layers attached to the Viewer; never more than one. */
	layers: number;
	/** Marker entities in the atlas layer, shown or not; the one preview pill is not counted. */
	entities: number;
	/** The scene-wide terrain depth test, which the atlas must leave at Cesium's default. */
	depthTestAgainstTerrain: boolean;
	markers: AtlasMarkerReading[];
}

export type ExposeAtlasLayer = (read: () => AtlasLayerReading | undefined) => () => void;

export interface PreviewPlacement {
	/** Where the pill stands, in CSS pixels from the top left of the canvas. */
	box: ScreenBox;
	/** How far the pill's bottom centre is from the marker's centre, y down: add to a bottom-anchored billboard. */
	offset: ScreenPoint;
}

export interface PreviewRoom {
	/** The stage in CSS pixels. */
	bounds: StageSize;
	/** What the pill must keep clear on the left and right: the stage's control columns. */
	sideInsetPixels: number;
}

/**
 * Where the preview pill goes for a marker at `anchor`: centred above its dot, slid sideways to
 * stay clear of the control columns and the stage's edges, and below the dot when there is no room
 * above. A pill wider than the room between the columns falls back to the edge margin alone.
 * Pure arithmetic on a handful of numbers, once per visibility pass for the one emphasized marker.
 */
export function placePreview(
	anchor: ScreenPoint,
	pill: { width: number; height: number },
	dotRadiusPixels: number,
	{ bounds, sideInsetPixels }: PreviewRoom
): PreviewPlacement {
	const { gapPixels, edgeMarginPixels } = ATLAS_MARKER_STYLE.preview;
	const inset =
		pill.width <= bounds.width - 2 * sideInsetPixels ? sideInsetPixels : edgeMarginPixels;
	const lowest = Math.max(bounds.width - inset - pill.width, inset);
	const left = Math.min(Math.max(anchor.x - pill.width / 2, inset), lowest);

	const reach = dotRadiusPixels + gapPixels;
	const above = anchor.y - reach - pill.height >= edgeMarginPixels;
	const top = above ? anchor.y - reach - pill.height : anchor.y + reach;

	return {
		box: { left, right: left + pill.width, top, bottom: top + pill.height },
		offset: { x: left + pill.width / 2 - anchor.x, y: top + pill.height - anchor.y }
	};
}
