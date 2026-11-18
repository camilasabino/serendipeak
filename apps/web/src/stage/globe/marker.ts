import { formatElevation } from '../../formatElevation';
import type { SceneTarget } from './camera';

export interface SummitMarker {
	latitude: number;
	longitude: number;
	elevationMeters: number;
	name: string;
	elevation: string;
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

export interface SummitSpriteSource {
	disc(ratio: number): SummitSprite;
	pill(name: string, elevation: string, ratio: number): Promise<SummitSprite>;
}

/** The dark plate under every atlas label, so names read over snow as well as over rock. */
export const MARKER_LABEL_PLATE = {
	// The stage colour, near black; Cesium cannot read the CSS variable.
	color: '#0b1219',
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
		radius: 7,
		ringWidth: 2,
		haloWidth: 1.5,
		haloAlpha: 0.85
	},
	pill: {
		height: 42,
		paddingLeft: 12.8,
		paddingRight: 14.4,
		gap: 8.8,
		/** Longest name plus elevation the pill will draw; longer names end in an ellipsis. */
		maxContentWidth: 300,
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

export function planSummitMarker(target: SceneTarget): SummitMarker {
	const { name, latitude, longitude, elevationMeters } = target;

	return {
		latitude,
		longitude,
		elevationMeters,
		name,
		elevation: formatElevation(elevationMeters)
	};
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
	elevation: string
): PillLayout {
	const { height, paddingLeft, paddingRight, gap, maxContentWidth, shadow } =
		SUMMIT_MARKER_STYLE.pill;
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
