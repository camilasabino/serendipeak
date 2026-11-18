import { ATLAS_MARKER_STYLE } from './atlasMarkers';
import {
	SUMMIT_MARKER_STYLE,
	layoutSummitPill,
	type AtlasDotState,
	type AtlasSpriteSource,
	type PillLayout,
	type PillText,
	type SummitSprite,
	type SummitSpriteSource
} from './marker';

export interface SpriteCanvas {
	width: number;
	height: number;
	getContext(type: '2d'): CanvasRenderingContext2D | null;
	toDataURL(type: string): string;
}

export interface SpriteHost {
	createCanvas(): SpriteCanvas;
	/** Resolves once the faces that draw `text` are usable, whether or not they could be loaded. */
	loadFaces(faces: readonly string[], text: string): Promise<void>;
}

const MAX_CACHED_SPRITES = 16;

const browserHost: SpriteHost = {
	createCanvas: () => document.createElement('canvas'),
	async loadFaces(faces, text) {
		try {
			await Promise.all(faces.map((face) => document.fonts.load(face, text)));
		} catch {
			// A face that cannot load leaves the fallback in the stack, which measures and draws the same.
		}
	}
};

const { colors, disc, pill } = SUMMIT_MARKER_STYLE;

function nameFont(): string {
	return `${pill.name.weight} ${pill.name.sizePixels}px ${pill.name.family}`;
}

function elevationFont(): string {
	return `${pill.elevation.weight} ${pill.elevation.sizePixels}px ${pill.elevation.family}`;
}

function firstFamily(family: string): string {
	return family.split(',')[0]!.trim();
}

function textStyle(context: CanvasRenderingContext2D, part: PillText): void {
	const isName = part === 'name';
	context.font = isName ? nameFont() : elevationFont();
	context.fontStretch = isName ? 'normal' : pill.elevation.stretch;
	context.letterSpacing = isName ? `${pill.name.letterSpacingEm * pill.name.sizePixels}px` : '0px';
	context.textBaseline = 'middle';
	context.textAlign = 'left';
}

function withAlpha(hex: string, alpha: number): string {
	const value = Number.parseInt(hex.slice(1), 16);

	return `rgb(${value >> 16} ${(value >> 8) & 255} ${value & 255} / ${alpha})`;
}

function roundedRectangle(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number
): void {
	const radius = Math.min(width, height) / 2;

	context.beginPath();
	context.moveTo(x + radius, y);
	context.arcTo(x + width, y, x + width, y + height, radius);
	context.arcTo(x + width, y + height, x, y + height, radius);
	context.arcTo(x, y + height, x, y, radius);
	context.arcTo(x, y, x + width, y, radius);
	context.closePath();
}

/**
 * The summit's disc and pill as images for billboards. Each is drawn once per size and pixel density
 * and handed over as a data URL, which Cesium uses as the image's identity: showing the same
 * mountain again reuses the texture it already holds instead of adding another to the atlas, which
 * never gives textures back. The cache is small, since only the mountain on stage is ever drawn.
 */
export class SummitSprites implements SummitSpriteSource, AtlasSpriteSource {
	private readonly discs = new Map<number, SummitSprite>();
	private readonly dots = new Map<string, SummitSprite>();
	private readonly pills = new Map<string, Promise<SummitSprite>>();

	constructor(private readonly host: SpriteHost = browserHost) {}

	disc(ratio: number): SummitSprite {
		const cached = this.discs.get(ratio);
		if (cached) {
			return cached;
		}

		const sprite = this.drawDisc(ratio);
		this.discs.set(ratio, sprite);
		evictOldest(this.discs);

		return sprite;
	}

	/** The atlas dot: at most two images per pixel density, shared by every marker. */
	dot(state: AtlasDotState, ratio: number): SummitSprite {
		const key = `${state}@${ratio}`;
		const cached = this.dots.get(key);
		if (cached) {
			return cached;
		}

		const sprite = this.drawDot(state, ratio);
		this.dots.set(key, sprite);
		evictOldest(this.dots);

		return sprite;
	}

	pill(
		name: string,
		elevation: string,
		ratio: number,
		maxContentWidth: number
	): Promise<SummitSprite> {
		const key = `${ratio}\u0000${maxContentWidth}\u0000${elevation}\u0000${name}`;
		const cached = this.pills.get(key);
		if (cached) {
			this.pills.delete(key);
			this.pills.set(key, cached);
			return cached;
		}

		const drawn = this.drawPill(name, elevation, ratio, maxContentWidth);
		this.pills.set(key, drawn);
		evictOldest(this.pills);
		drawn.catch(() => this.pills.delete(key));

		return drawn;
	}

	private drawDisc(ratio: number): SummitSprite {
		const reach = disc.radius + disc.ringWidth + disc.haloWidth;
		const size = Math.ceil(reach * 2 + 2);
		const { canvas, context } = this.surface(size, size, ratio);
		const center = size / 2;
		const circle = (radius: number, fill: string) => {
			context.beginPath();
			context.arc(center, center, radius, 0, Math.PI * 2);
			context.fillStyle = fill;
			context.fill();
		};

		circle(reach, withAlpha(colors.basalt, disc.haloAlpha));
		circle(disc.radius + disc.ringWidth, colors.snow);
		circle(disc.radius, colors.copper);

		return {
			image: canvas.toDataURL('image/png'),
			width: size,
			height: size,
			bottomInset: 0
		};
	}

	private drawDot(state: AtlasDotState, ratio: number): SummitSprite {
		const dot = ATLAS_MARKER_STYLE.dot;
		const emphasized = state === 'emphasized';
		const radius = emphasized ? dot.radius * dot.emphasizedScale : dot.radius;
		const halo = radius + dot.ringWidth + dot.haloWidth;
		const reach = emphasized ? halo + dot.glowWidth : halo;
		const size = Math.ceil(reach * 2 + 2);
		const { canvas, context } = this.surface(size, size, ratio);
		const center = size / 2;
		const circle = (circleRadius: number, fill: string) => {
			context.beginPath();
			context.arc(center, center, circleRadius, 0, Math.PI * 2);
			context.fillStyle = fill;
			context.fill();
		};

		if (emphasized) {
			circle(reach, withAlpha(colors.snow, dot.glowAlpha));
		}
		circle(halo, withAlpha(colors.basalt, disc.haloAlpha));
		circle(radius + dot.ringWidth, colors.snow);
		circle(radius, colors.copper);

		return { image: canvas.toDataURL('image/png'), width: size, height: size, bottomInset: 0 };
	}

	private async drawPill(
		name: string,
		elevation: string,
		ratio: number,
		maxContentWidth: number
	): Promise<SummitSprite> {
		await this.host.loadFaces(
			[
				`${pill.name.weight} ${pill.name.sizePixels}px ${firstFamily(pill.name.family)}`,
				`${pill.elevation.weight} ${pill.elevation.sizePixels}px ${firstFamily(pill.elevation.family)}`
			],
			`${name} ${elevation}`
		);

		const probe = this.surface(1, 1, 1).context;
		const layout = layoutSummitPill(
			(text, part) => {
				textStyle(probe, part);
				return probe.measureText(text).width;
			},
			name,
			elevation,
			maxContentWidth
		);
		const { canvas, context } = this.surface(layout.imageWidth, layout.imageHeight, ratio);
		paintPill(context, layout, elevation);

		return {
			image: canvas.toDataURL('image/png'),
			width: layout.imageWidth,
			height: layout.imageHeight,
			bottomInset: layout.padding.bottom
		};
	}

	private surface(width: number, height: number, ratio: number) {
		const canvas = this.host.createCanvas();
		canvas.width = Math.ceil(width * ratio);
		canvas.height = Math.ceil(height * ratio);

		const context = canvas.getContext('2d');
		if (!context) {
			throw new Error('A 2D canvas context is not available.');
		}
		context.scale(ratio, ratio);

		return { canvas, context };
	}
}

function paintPill(context: CanvasRenderingContext2D, layout: PillLayout, elevation: string): void {
	const { padding, pillWidth } = layout;
	const { height, ringAlpha, shadow } = pill;
	const middle = padding.top + height / 2;

	context.save();
	context.shadowColor = `rgb(0 0 0 / ${shadow.alpha})`;
	context.shadowBlur = shadow.blur;
	context.shadowOffsetY = shadow.offsetY;
	roundedRectangle(context, padding.left, padding.top, pillWidth, height);
	context.fillStyle = colors.basalt;
	context.fill();
	context.restore();

	// The reference's inset ring: a 1 px line drawn just inside the edge.
	roundedRectangle(context, padding.left + 0.5, padding.top + 0.5, pillWidth - 1, height - 1);
	context.lineWidth = 1;
	context.strokeStyle = withAlpha(colors.snow, ringAlpha);
	context.stroke();

	textStyle(context, 'name');
	context.fillStyle = colors.snow;
	context.fillText(layout.name, layout.nameX, middle);

	textStyle(context, 'elevation');
	context.fillStyle = colors.copper;
	context.fillText(elevation, layout.elevationX, middle);
}

function evictOldest<K>(cache: Map<K, unknown>): void {
	while (cache.size > MAX_CACHED_SPRITES) {
		cache.delete(cache.keys().next().value as K);
	}
}
