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
 * label shows. Names come in from a regional distance: fully legible up to 1,200 km, fading out to
 * nothing at 1,600 km. Summits a few kilometres apart (Cerro Torre and Fitz Roy, Everest and Ama
 * Dablam) still overlap there until labels are decluttered on screen.
 */
export const ATLAS_MARKER_STYLE = {
	pointPixelSize: 7,
	pointOutlinePixels: 2,
	/** Full size up to this distance, shrinking linearly to `pointFarScale` at `pointFarMeters`. */
	pointNearMeters: 250_000,
	pointFarMeters: 8_000_000,
	pointFarScale: 0.6,
	/** Opaque up to this distance, fading linearly to `pointFarAlpha` at `pointFadedMeters`. */
	pointOpaqueMeters: 3_000_000,
	pointFadedMeters: 15_000_000,
	pointFarAlpha: 0.8,
	// Cesium rasterizes labels on a canvas before web fonts may have loaded, so a system face keeps
	// glyphs from being cached in a fallback, as the summit marker's label does.
	labelFont: '500 13px system-ui, sans-serif',
	labelOffsetPixels: 7,
	labelOutlinePixels: 2,
	/** Fully legible up to this distance, fading out to nothing at `labelMaxMeters`. */
	labelFullMeters: 1_200_000,
	labelMaxMeters: 1_600_000,
	// Over the globe a label this faint cannot be read, so it is dropped: it takes no screen space
	// from a legible neighbour and is not a place to press. Its marker still shows and still opens.
	labelMinAlpha: 0.3,
	// Vermilion with an ink outline reads over snow, desert, ocean and forest alike. Ink and paper are
	// the stage's tokens; Cesium draws on its own canvas and cannot read CSS variables.
	pointColor: '#f06445',
	outlineColor: '#14202a',
	outlineAlpha: 0.9,
	labelColor: '#f1f3ef',
	// The marker under the mouse trades its ink ring for a paper one: same size and place, so it
	// covers no more of a neighbour than before.
	hoverOutlineColor: '#f1f3ef'
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

// Cesium's NearFarScalar: the near value up to `near`, the far value beyond `far`, linear between.
function nearFar(distance: number, near: number, nearValue: number, far: number, farValue: number) {
	const t = Math.min(Math.max((distance - near) / (far - near), 0), 1);

	return nearValue + (farValue - nearValue) * t;
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
}

export interface AtlasLayerReading {
	/** The layer is on the globe: markers set and not hidden. */
	shown: boolean;
	/** The marker the mouse rests on, emphasized, if one would open on a click. */
	hovered?: string;
	/** Atlas layers attached to the Viewer; never more than one. */
	layers: number;
	/** Entities in the atlas layer, shown or not. */
	entities: number;
	/** The scene-wide terrain depth test, which the atlas must leave at Cesium's default. */
	depthTestAgainstTerrain: boolean;
	markers: AtlasMarkerReading[];
}

export type ExposeAtlasLayer = (read: () => AtlasLayerReading | undefined) => () => void;
