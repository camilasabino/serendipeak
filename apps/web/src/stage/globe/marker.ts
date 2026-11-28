import type { ScreenBox, ScreenPoint } from './atlasMarkers';
import type { SceneTarget } from './camera';

/** Canonical data only: the display words the elevation in the unit the reader has chosen. */
export interface SummitMarker {
	latitude: number;
	longitude: number;
	elevationMeters: number;
	name: string;
}

export interface SummitMarkerDisplay {
	show(marker: SummitMarker): void;
	hide(): void;
}

/** A drawn image for a billboard; sizes are CSS pixels, the image itself holds `ratio` texels per pixel. */
export interface SummitSprite {
	image: string;
	width: number;
	height: number;
	/** Pixels between the bottom edge of the image and the bottom edge of the shape drawn in it. */
	bottomInset: number;
}

/** The atlas dot at rest, or emphasized by a pointer or by its row in the list. */
export type AtlasDotState = 'rest' | 'emphasized';

export interface SummitSpriteSource {
	disc(ratio: number, scale?: number): SummitSprite;
	pill(
		name: string,
		elevation: string,
		ratio: number,
		maxContentWidth: number,
		scale?: number
	): Promise<SummitSprite>;
}

/** What the atlas draws with: its dot in two states, and the same pill as the summit. */
export interface AtlasSpriteSource {
	dot(state: AtlasDotState, ratio: number): SummitSprite;
	pill: SummitSpriteSource['pill'];
}

/** The dark plate under every atlas label, so names read over snow as well as over rock. */
export const MARKER_LABEL_PLATE = {
	// Basalt; Cesium cannot read the CSS variable, and marker.spec compares the two.
	color: '#110f0e',
	alpha: 0.78,
	paddingPixels: { x: 7, y: 4 }
} as const;

/**
 * Cesium cannot read CSS variables, so the colours and font stacks below mirror the `--sp-*`
 * tokens in shell/tokens.css; marker.spec.ts compares the two copies.
 */
export const SUMMIT_MARKER_STYLE = {
	maxDistanceMeters: 300_000,
	/** From the summit to the bottom edge of the pill. */
	labelOffsetPixels: 12,
	colors: {
		basalt: '#110f0e',
		snow: '#f3eee8',
		copper: '#df9a66'
	},
	disc: {
		/** The summit disc is drawn at this fraction of the reference size; the atlas dot is not scaled. */
		scale: 0.75,
		radius: 7,
		ringWidth: 2,
		haloWidth: 1.5,
		haloAlpha: 0.85
	},
	pill: {
		/** The summit pill's height, padding and gap relative to the atlas pill; its type is not scaled. */
		summitScale: 0.81,
		height: 42,
		paddingLeft: 12.8,
		paddingRight: 14.4,
		gap: 8.8,
		/** Longest name plus elevation the pill will draw; longer names end in an ellipsis. */
		maxContentWidth: 300,
		/** Narrowest run a narrow stage may shrink it to, so a name still reads. */
		minContentWidth: 140,
		ringAlpha: 0.16,
		shadow: { blur: 10, offsetY: 4, alpha: 0.5 },
		name: {
			family: "'Marcellus', 'Optima', 'Candara', serif",
			weight: 400,
			sizePixels: 16,
			letterSpacingEm: 0.015
		},
		elevation: {
			family: "'Archivo Variable', 'Helvetica Neue', Arial, sans-serif",
			weight: 600,
			sizePixels: 13,
			// Canvas takes width keywords only; the approved 92 % has none, and 87.5 % is the nearest.
			stretch: 'semi-condensed'
		}
	}
} as const;

/** The pill's box at `scale`; the type inside it keeps its size. */
export function pillGeometry(scale = 1) {
	const { height, paddingLeft, paddingRight, gap } = SUMMIT_MARKER_STYLE.pill;

	return {
		height: height * scale,
		paddingLeft: paddingLeft * scale,
		paddingRight: paddingRight * scale,
		gap: gap * scale
	};
}

/** The page's root font size, which the stage's control columns scale with. */
export function rootFontPixels(): number {
	if (typeof document === 'undefined') {
		return 16;
	}

	return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** The stage's control columns: a 0.6 rem inset, a 2.75 rem button and a 0.4 rem gap on each edge. */
export const CONTROL_GUTTER_REM = 3.75;

/**
 * The widest name-and-elevation run a pill may hold on a stage `stageWidth` pixels wide. The pill is
 * centred on the summit, so it stays between the control columns instead of running under them.
 */
export function summitPillMaxContentWidth(
	stageWidth: number,
	rootFontPixels = 16,
	scale = 1
): number {
	const { maxContentWidth, minContentWidth } = SUMMIT_MARKER_STYLE.pill;
	const { paddingLeft, paddingRight } = pillGeometry(scale);
	if (!(stageWidth > 0)) {
		return maxContentWidth;
	}

	const clear = stageWidth - 2 * CONTROL_GUTTER_REM * rootFontPixels - paddingLeft - paddingRight;

	return Math.floor(Math.min(maxContentWidth, Math.max(minContentWidth, clear)));
}

/**
 * Where the presented summit's disc and pill can be drawn around the summit's place on screen, in
 * CSS pixels. The pill is taken at the widest the stage lets it be, so the box holds it whatever
 * name it carries and whether or not the layout draws it.
 */
export function summitMarkerFootprint(
	summit: ScreenPoint,
	stageWidth: number,
	rootFontPixels = 16
): ScreenBox {
	const { disc, pill, labelOffsetPixels } = SUMMIT_MARKER_STYLE;
	const { height, paddingLeft, paddingRight } = pillGeometry(pill.summitScale);
	const pillWidth =
		summitPillMaxContentWidth(stageWidth, rootFontPixels, pill.summitScale) +
		paddingLeft +
		paddingRight;
	const discRadius = (disc.radius + disc.ringWidth + disc.haloWidth) * disc.scale;
	const halfWidth = Math.max(pillWidth / 2, discRadius);

	return {
		left: summit.x - halfWidth,
		right: summit.x + halfWidth,
		top: summit.y - labelOffsetPixels - height,
		bottom: summit.y + discRadius
	};
}

/** The pill as drawn, without the room its image keeps around it for the shadow. */
export function pillFootprint(sprite: SummitSprite): { width: number; height: number } {
	const { height, shadow } = SUMMIT_MARKER_STYLE.pill;

	return { width: Math.max(sprite.width - 2 * shadow.blur, 0), height };
}

export function planSummitMarker(target: SceneTarget): SummitMarker {
	const { name, latitude, longitude, elevationMeters } = target;

	return { latitude, longitude, elevationMeters, name };
}

export interface PillLayout {
	/** The text to draw for the name, shortened if it would not fit. */
	name: string;
	/** Everything below is in CSS pixels, within the padded image. */
	pillWidth: number;
	imageWidth: number;
	imageHeight: number;
	/** Space kept around the pill for its shadow. */
	padding: { left: number; right: number; top: number; bottom: number };
	nameX: number;
	elevationX: number;
}

export type PillText = 'name' | 'elevation';
export type MeasurePillText = (text: string, part: PillText) => number;

export function fitText(text: string, maxWidth: number, measure: (text: string) => number): string {
	if (measure(text) <= maxWidth) {
		return text;
	}

	const characters = Array.from(text);
	let kept = characters.length;
	while (kept > 1 && measure(`${characters.slice(0, kept).join('').trimEnd()}…`) > maxWidth) {
		kept -= 1;
	}

	return `${characters.slice(0, kept).join('').trimEnd()}…`;
}

export function layoutSummitPill(
	measure: MeasurePillText,
	name: string,
	elevation: string,
	maxContentWidth: number = SUMMIT_MARKER_STYLE.pill.maxContentWidth,
	scale = 1
): PillLayout {
	const { shadow } = SUMMIT_MARKER_STYLE.pill;
	const { height, paddingLeft, paddingRight, gap } = pillGeometry(scale);
	const elevationWidth = measure(elevation, 'elevation');
	const nameBudget = maxContentWidth - elevationWidth - gap;
	const shown = fitText(name, nameBudget, (text) => measure(text, 'name'));
	const nameWidth = measure(shown, 'name');
	const pillWidth = Math.ceil(paddingLeft + nameWidth + gap + elevationWidth + paddingRight);
	const side = shadow.blur;
	const padding = {
		left: side,
		right: side,
		top: Math.max(shadow.blur - shadow.offsetY, 0),
		bottom: shadow.blur + shadow.offsetY
	};

	return {
		name: shown,
		pillWidth,
		imageWidth: pillWidth + padding.left + padding.right,
		imageHeight: height + padding.top + padding.bottom,
		padding,
		nameX: padding.left + paddingLeft,
		elevationX: padding.left + paddingLeft + nameWidth + gap
	};
}

/**
 * Drawing-buffer pixels per CSS pixel of the Cesium canvas. Sprites are drawn at this density so
 * one texel lands on one pixel, whether the Viewer renders at browser resolution or above it.
 */
export function renderRatio(canvas: { width: number; clientWidth: number }): number {
	if (!(canvas.clientWidth > 0) || !(canvas.width > 0)) {
		return 1;
	}

	return Math.round(Math.min(Math.max(canvas.width / canvas.clientWidth, 1), 3) * 100) / 100;
}
