import { describe, expect, it } from 'vitest';
import { ATLAS_MARKER_STYLE } from './atlasMarkers';
import { SUMMIT_MARKER_STYLE } from './marker';
import { SummitSprites, type SpriteCanvas, type SpriteHost } from './summitSprites';

class FakeHost implements SpriteHost {
	readonly events: string[] = [];
	readonly fills: unknown[] = [];
	canvases = 0;
	fontsReady: Promise<void> = Promise.resolve();
	failContext = false;

	createCanvas(): SpriteCanvas {
		const id = ++this.canvases;
		const events = this.events;
		const fills = this.fills;
		const context = new Proxy(
			{ measureText: (text: string) => ({ width: text.length * 8 }) },
			{
				get: (target, key) =>
					key in target ? target[key as keyof typeof target] : () => undefined,
				set: (_target, key, value) => {
					if (key === 'fillStyle') {
						fills.push(value);
					}
					return true;
				}
			}
		) as unknown as CanvasRenderingContext2D;
		const canvas = {
			width: 0,
			height: 0,
			getContext: () => (this.failContext ? null : context),
			toDataURL: () => {
				events.push(`encode:${canvas.width}x${canvas.height}`);
				return `data:image/png;base64,${id}-${canvas.width}x${canvas.height}`;
			}
		};

		return canvas;
	}

	async loadFaces(faces: readonly string[], text: string): Promise<void> {
		this.events.push(`faces:${faces.length}:${text}`);
		await this.fontsReady;
		this.events.push('faces-ready');
	}
}

describe('SummitSprites', () => {
	it('draws the pill only after its faces are ready, at the density asked for', async () => {
		const host = new FakeHost();
		let release!: () => void;
		host.fontsReady = new Promise((resolve) => (release = resolve));
		const sprites = new SummitSprites(host);

		const pill = sprites.pill('Matterhorn', '4,478 m', 2, 300);
		await Promise.resolve();
		expect(host.events).toEqual(['faces:2:Matterhorn 4,478 m']);
		expect(host.canvases).toBe(0);

		release();
		const sprite = await pill;
		expect(host.events.at(-1)).toBe(`encode:${sprite.width * 2}x${sprite.height * 2}`);
		expect(sprite.image).toMatch(/^data:image\/png/);
		expect(sprite.bottomInset).toBeGreaterThan(0);
	});

	it('hands back the same sprite for the same summit, so Cesium keeps one texture', async () => {
		const host = new FakeHost();
		const sprites = new SummitSprites(host);

		const first = await sprites.pill('Matterhorn', '4,478 m', 1, 300);
		const canvases = host.canvases;
		const again = await sprites.pill('Matterhorn', '4,478 m', 1, 300);

		expect(again).toBe(first);
		expect(host.canvases).toBe(canvases);
		expect(sprites.disc(1)).toBe(sprites.disc(1));
		expect((await sprites.pill('Matterhorn', '4,478 m', 2, 300)).image).not.toBe(first.image);
	});

	it('draws a narrower pill for a narrower stage and keeps the two apart', async () => {
		const host = new FakeHost();
		const sprites = new SummitSprites(host);

		const wide = await sprites.pill('Piton de la Fournaise', '2,632 m', 1, 300);
		const narrow = await sprites.pill('Piton de la Fournaise', '2,632 m', 1, 170);

		expect(narrow.width).toBeLessThan(wide.width);
		expect(await sprites.pill('Piton de la Fournaise', '2,632 m', 1, 170)).toBe(narrow);
	});

	it('keeps a bounded number of pills', async () => {
		const host = new FakeHost();
		const sprites = new SummitSprites(host);

		const first = await sprites.pill('Peak 0', '1 m', 1, 300);
		for (let index = 1; index <= 16; index += 1) {
			await sprites.pill(`Peak ${index}`, '1 m', 1, 300);
		}

		expect(await sprites.pill('Peak 0', '1 m', 1, 300)).not.toBe(first);
	});

	it('forgets a draw that failed so the next request tries again', async () => {
		const host = new FakeHost();
		host.failContext = true;
		const sprites = new SummitSprites(host);

		await expect(sprites.pill('Matterhorn', '4,478 m', 1, 300)).rejects.toThrow('2D canvas');
		host.failContext = false;
		await expect(sprites.pill('Matterhorn', '4,478 m', 1, 300)).resolves.toMatchObject({
			image: expect.stringMatching(/^data:image\/png/)
		});
	});

	it('draws the disc at once with room for its halo', () => {
		const sprites = new SummitSprites(new FakeHost());
		const disc = sprites.disc(1);

		expect(disc.width).toBe(disc.height);
		expect(disc.width).toBeGreaterThanOrEqual(2 * (7 + 2 + 1.5));
		expect(disc.bottomInset).toBe(0);
	});

	it('draws the atlas dot in two states, each once per density, the emphasized one with its glow', () => {
		const host = new FakeHost();
		const sprites = new SummitSprites(host);
		const { dot } = ATLAS_MARKER_STYLE;
		const rest = sprites.dot('rest', 1);
		const emphasized = sprites.dot('emphasized', 1);
		const canvases = host.canvases;

		expect(sprites.dot('rest', 1)).toBe(rest);
		expect(sprites.dot('emphasized', 1)).toBe(emphasized);
		expect(host.canvases).toBe(canvases);
		expect(rest.image).not.toBe(emphasized.image);
		expect(sprites.dot('rest', 2).image).not.toBe(rest.image);
		expect(rest.width).toBe(Math.ceil((dot.radius + dot.ringWidth + dot.haloWidth) * 2 + 2));
		expect(emphasized.width).toBeGreaterThan(rest.width);
		expect(rest.bottomInset).toBe(0);
	});

	it('fills the atlas dot with its own red, while the summit disc keeps copper', () => {
		const host = new FakeHost();
		const sprites = new SummitSprites(host);

		sprites.dot('rest', 1);
		expect(host.fills).toContain(ATLAS_MARKER_STYLE.dot.fill);
		expect(host.fills).not.toContain(SUMMIT_MARKER_STYLE.colors.copper);

		host.fills.length = 0;
		sprites.disc(1);
		expect(host.fills).toContain(SUMMIT_MARKER_STYLE.colors.copper);
		expect(host.fills).not.toContain(ATLAS_MARKER_STYLE.dot.fill);
	});
});
