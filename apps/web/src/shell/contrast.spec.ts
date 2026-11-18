import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const sourceRoot = path.resolve(import.meta.dirname, '..');
const webRoot = path.resolve(sourceRoot, '..');
const tokens = readFileSync(path.join(import.meta.dirname, 'tokens.css'), 'utf8');
const app = readFileSync(path.join(sourceRoot, 'pages/_app.tsx'), 'utf8');

const brand = {
	stage: '#0B1219',
	ink: '#14202A',
	glacier: '#2A78A8',
	glacierDark: '#1D5F8A',
	glacierLight: '#8CB8D2',
	paper: '#F1F3EF',
	paperBright: '#F7F8F5',
	mist: '#D7DEE1'
} as const;

const identity = {
	basalt: '#110F0E',
	basalt1: '#181514',
	basalt2: '#211D1B',
	basalt3: '#2B2623',
	snow: '#F3EEE8',
	snowMuted: '#B3A99F',
	copper: '#DF9A66',
	copperDeep: '#D18A55',
	copperLight: '#E3A171',
	copperInk: '#140C07',
	ice: '#9FD2DA'
} as const;

const white = '#FFFFFF';

function channel(hex: string, index: number): number {
	return Number.parseInt(hex.slice(index, index + 2), 16);
}

function linear(channelValue: number): number {
	const value = channelValue / 255;
	return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
	return (
		0.2126 * linear(channel(hex, 1)) +
		0.7152 * linear(channel(hex, 3)) +
		0.0722 * linear(channel(hex, 5))
	);
}

function contrast(foreground: string, background: string): number {
	const lighter = Math.max(luminance(foreground), luminance(background));
	const darker = Math.min(luminance(foreground), luminance(background));
	return (lighter + 0.05) / (darker + 0.05);
}

function hex(value: number): string {
	return Math.round(value).toString(16).padStart(2, '0');
}

// What a translucent fill looks like once composited over an opaque backdrop.
function over(foreground: string, alpha: number, background: string): string {
	const mix = (index: number) =>
		hex(alpha * channel(foreground, index) + (1 - alpha) * channel(background, index));
	return `#${mix(1)}${mix(3)}${mix(5)}`;
}

function* styleSheets(directory: string): Generator<string> {
	for (const entry of readdirSync(directory, { withFileTypes: true })) {
		const entryPath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			yield* styleSheets(entryPath);
		} else if (entry.name.endsWith('.css')) {
			yield entryPath;
		}
	}
}

describe('brand tokens', () => {
	it('keeps the approved palette as the only brand hex values', () => {
		for (const [token, value] of [
			['--sp-stage', brand.stage],
			['--sp-ink', brand.ink],
			['--sp-glacier', brand.glacier],
			['--sp-glacier-dark', brand.glacierDark],
			['--sp-glacier-light', brand.glacierLight],
			['--sp-paper', brand.paper],
			['--sp-paper-bright', brand.paperBright],
			['--sp-mist', brand.mist]
		] as const) {
			expect(tokens.toLowerCase()).toContain(`${token}: ${value.toLowerCase()}`);
		}
	});

	it('maps text, accent and focus roles onto that palette', () => {
		expect(tokens).toContain('--sp-surface-stage: var(--sp-stage)');
		expect(tokens).toContain('--sp-text-on-stage: var(--sp-paper)');
		expect(tokens).toContain('--sp-accent: var(--sp-glacier)');
		expect(tokens).toContain('--sp-accent-hover: var(--sp-glacier-dark)');
		expect(tokens).toContain('--sp-link-on-stage: var(--sp-glacier-light)');
		expect(tokens).toContain('--sp-link-on-stage-hover: var(--sp-paper-bright)');
		expect(tokens).toContain('--sp-focus: var(--sp-paper-bright)');
		expect(tokens).toContain('--sp-rule: color-mix(in srgb, var(--sp-mist) 22%, transparent)');
		expect(tokens).toContain(
			'--sp-rule-quiet: color-mix(in srgb, var(--sp-mist) 12%, transparent)'
		);
	});

	it('keeps the identity palette as brand hex values', () => {
		for (const [token, value] of [
			['--sp-basalt', identity.basalt],
			['--sp-basalt-1', identity.basalt1],
			['--sp-basalt-2', identity.basalt2],
			['--sp-basalt-3', identity.basalt3],
			['--sp-snow', identity.snow],
			['--sp-snow-muted', identity.snowMuted],
			['--sp-copper', identity.copper],
			['--sp-copper-deep', identity.copperDeep],
			['--sp-copper-light', identity.copperLight],
			['--sp-copper-ink', identity.copperInk],
			['--sp-ice', identity.ice]
		] as const) {
			expect(tokens.toLowerCase()).toContain(`${token}: ${value.toLowerCase()}`);
		}
	});

	it('allows no hex value in the tokens outside the two palettes', () => {
		const approved = new Set(
			[...Object.values(brand), ...Object.values(identity)].map((value) => value.toLowerCase())
		);
		const used = (tokens.match(/#[0-9a-f]{3,8}\b/gi) ?? []).map((value) => value.toLowerCase());

		expect(used.filter((value) => !approved.has(value))).toEqual([]);
	});

	it('maps the identity roles onto its palette', () => {
		for (const mapping of [
			'--sp-surface-base: var(--sp-basalt)',
			'--sp-surface-sheet: var(--sp-basalt-1)',
			'--sp-surface-raised: var(--sp-basalt-2)',
			'--sp-photo-mat: var(--sp-basalt-3)',
			'--sp-text: var(--sp-snow)',
			'--sp-text-muted: var(--sp-snow-muted)',
			'--sp-text-accent: var(--sp-copper)',
			'--sp-link: var(--sp-ice)',
			'--sp-link-rule: color-mix(in srgb, var(--sp-ice) 45%, transparent)',
			'--sp-action: var(--sp-copper-deep)',
			'--sp-action-hover: var(--sp-copper-light)',
			'--sp-on-action: var(--sp-copper-ink)',
			'--sp-state-accent: var(--sp-copper)',
			'--sp-state-hover: color-mix(in srgb, var(--sp-snow) 8%, transparent)',
			'--sp-selection: color-mix(in srgb, var(--sp-copper) 35%, transparent)',
			'--sp-focus-ring: var(--sp-copper)',
			'--sp-divider: color-mix(in srgb, var(--sp-snow) 10%, transparent)',
			'--sp-divider-strong: color-mix(in srgb, var(--sp-snow) 30%, transparent)',
			'--sp-divider-control: color-mix(in srgb, var(--sp-snow) 40%, transparent)',
			'--sp-divider-chrome: color-mix(in srgb, var(--sp-snow) 9%, transparent)',
			'--sp-divider-accent: var(--sp-copper)',
			'--sp-chip: color-mix(in srgb, var(--sp-basalt) 80%, transparent)',
			'--sp-chip-rule: color-mix(in srgb, var(--sp-snow) 14%, transparent)',
			'--sp-chip-text: var(--sp-snow)',
			'--sp-geo-label: var(--sp-snow)',
			'--sp-geo-elevation: var(--sp-copper)',
			'--sp-geo-plate: var(--sp-basalt)',
			'--sp-geo-plate-ring: color-mix(in srgb, var(--sp-snow) 16%, transparent)',
			'--sp-contour: color-mix(in srgb, var(--sp-copper) 20%, transparent)',
			'--sp-contour-index: color-mix(in srgb, var(--sp-copper) 34%, transparent)'
		]) {
			expect(tokens).toContain(mapping);
		}
	});

	it('defines the motion scale', () => {
		expect(tokens).toContain('--sp-duration-short: 160ms');
		expect(tokens).toContain('--sp-duration-medium: 240ms');
		expect(tokens).toContain('--sp-duration-long: 420ms');
		expect(tokens).toContain('--sp-ease-out: cubic-bezier(0.16, 1, 0.3, 1)');
	});

	it('defines every token a stylesheet references and keeps hex colors out of components', () => {
		const defined = new Set([...tokens.matchAll(/^\s*(--sp-[a-z0-9-]+):/gm)].map((m) => m[1]));
		const components = [...styleSheets(sourceRoot)].filter(
			(file) => path.basename(file) !== 'tokens.css'
		);

		expect(components.length).toBeGreaterThan(0);
		for (const file of components) {
			const css = readFileSync(file, 'utf8');
			const referenced = [...css.matchAll(/var\((--sp-[a-z0-9-]+)\)/g)].map((m) => m[1]);

			expect(
				referenced.filter((name) => !defined.has(name ?? '')),
				file
			).toEqual([]);
			expect(css.match(/#[0-9a-f]{3,8}\b/gi) ?? [], file).toEqual([]);
		}
	});
});

describe('contrast', () => {
	it('clears WCAG AA for the text and control pairs the shell uses', () => {
		for (const background of [brand.ink, brand.stage]) {
			expect(contrast(brand.paper, background), `paper on ${background}`).toBeGreaterThan(7);
			expect(contrast(brand.mist, background), `mist on ${background}`).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(brand.glacierLight, background),
				`link on ${background}`
			).toBeGreaterThanOrEqual(4.5);
			expect(contrast(brand.paperBright, background), `focus on ${background}`).toBeGreaterThan(3);
		}

		expect(contrast(brand.paperBright, brand.glacier)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(brand.paperBright, brand.glacierDark)).toBeGreaterThanOrEqual(4.5);
	});

	it('clears WCAG AA for the identity text pairs on every surface', () => {
		for (const surface of [identity.basalt, identity.basalt1, identity.basalt2]) {
			expect(contrast(identity.snow, surface), `text on ${surface}`).toBeGreaterThan(7);
			expect(
				contrast(identity.snowMuted, surface),
				`muted text on ${surface}`
			).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(identity.copper, surface),
				`accent text on ${surface}`
			).toBeGreaterThanOrEqual(4.5);
			expect(contrast(identity.ice, surface), `link on ${surface}`).toBeGreaterThanOrEqual(4.5);
		}

		expect(contrast(identity.snowMuted, identity.basalt3), 'caption on mat').toBeGreaterThanOrEqual(
			4.5
		);
		expect(contrast(identity.copperInk, identity.copperDeep), 'action').toBeGreaterThanOrEqual(4.5);
		expect(
			contrast(identity.copperInk, identity.copperLight),
			'action hover'
		).toBeGreaterThanOrEqual(4.5);
	});

	it('keeps the copper focus ring and markers above 3:1 wherever they sit', () => {
		for (const surface of [identity.basalt, identity.basalt1, identity.basalt2, identity.basalt3]) {
			expect(contrast(identity.copper, surface), `focus on ${surface}`).toBeGreaterThanOrEqual(3);
		}

		expect(
			contrast(identity.copper, identity.copperInk),
			'arrow disc glyph'
		).toBeGreaterThanOrEqual(3);
	});

	it('keeps selected text and pressed controls legible', () => {
		for (const surface of [identity.basalt, identity.basalt1, identity.basalt2]) {
			const selection = over(identity.copper, 0.35, surface);
			const pressed = over(identity.snow, 0.08, surface);

			expect(contrast(identity.snow, selection), `selected on ${surface}`).toBeGreaterThanOrEqual(
				4.5
			);
			expect(contrast(identity.snow, pressed), `pressed on ${surface}`).toBeGreaterThanOrEqual(4.5);
			expect(
				contrast(identity.copper, pressed),
				`pressed accent on ${surface}`
			).toBeGreaterThanOrEqual(4.5);
		}
	});

	// The round Share and Copy link buttons carry no text, so their boundary is what identifies
	// them as controls and has to clear 3:1. The 30 % hairline measures 2.50:1 on the sheet.
	it('draws icon-only control boundaries at 3:1 or more on the surfaces they sit on', () => {
		for (const surface of [identity.basalt1, identity.basalt2]) {
			expect(
				contrast(over(identity.snow, 0.4, surface), surface),
				`control boundary on ${surface}`
			).toBeGreaterThanOrEqual(3);
		}

		expect(contrast(over(identity.snow, 0.4, identity.basalt1), identity.basalt1)).toBeCloseTo(
			3.49,
			1
		);
		expect(contrast(over(identity.snow, 0.3, identity.basalt1), identity.basalt1)).toBeLessThan(3);
	});

	it('keeps chip text legible over the brightest imagery', () => {
		const chipOnSnowfield = over(identity.basalt, 0.8, white);
		const plateOnSnowfield = identity.basalt;

		expect(contrast(identity.snow, chipOnSnowfield)).toBeGreaterThanOrEqual(4.5);
		expect(contrast(identity.snow, plateOnSnowfield)).toBeGreaterThan(7);
		expect(contrast(identity.copper, plateOnSnowfield)).toBeGreaterThanOrEqual(4.5);
	});

	it('keeps the stage notices legible on both surfaces they can appear on', () => {
		const bannerOnSnowfield = over(identity.basalt, 0.8, white);

		expect(contrast(identity.snow, bannerOnSnowfield), 'degraded banner').toBeGreaterThanOrEqual(7);
		expect(contrast(identity.snowMuted, identity.basalt), 'failure hint').toBeGreaterThanOrEqual(7);
		expect(contrast(identity.copperInk, identity.copperDeep), 'retry label').toBeGreaterThanOrEqual(
			4.5
		);
	});
});

describe('fonts', () => {
	it('loads Spectral and Instrument Sans from the build, with swap', () => {
		expect(app).toContain('@fontsource/spectral/400.css');
		expect(app).toContain('@fontsource/instrument-sans/400.css');
		expect(app).toContain('@fontsource/instrument-sans/500.css');
		expect(app).not.toMatch(/fonts\.googleapis\.com|fonts\.gstatic\.com/);

		for (const file of [
			'node_modules/@fontsource/spectral/400.css',
			'node_modules/@fontsource/instrument-sans/400.css',
			'node_modules/@fontsource/instrument-sans/500.css'
		]) {
			const css = readFileSync(path.join(webRoot, file), 'utf8');

			expect(css).toContain('font-display: swap');
			expect(css).toContain('unicode-range:');
		}
	});

	it('puts the loaded families first in the font tokens', () => {
		expect(tokens).toMatch(/--sp-font-display: 'Spectral',/);
		expect(tokens).toMatch(/--sp-font-ui: 'Instrument Sans',/);
	});

	it('self-hosts Marcellus and the width-axis Archivo, with swap', () => {
		expect(app).toContain('@fontsource/marcellus/400.css');
		expect(app).toContain('@fontsource-variable/archivo/wdth.css');

		const marcellus = readFileSync(
			path.join(webRoot, 'node_modules/@fontsource/marcellus/400.css'),
			'utf8'
		);
		const archivo = readFileSync(
			path.join(webRoot, 'node_modules/@fontsource-variable/archivo/wdth.css'),
			'utf8'
		);

		for (const css of [marcellus, archivo]) {
			expect(css).toContain('font-display: swap');
			expect(css).toContain('unicode-range:');
		}
		expect(marcellus).toContain("font-family: 'Marcellus'");
		expect(archivo).toContain("font-family: 'Archivo Variable'");
		expect(archivo).toContain('font-weight: 100 900');
		expect(archivo).not.toContain('font-style: italic');
	});

	it('puts the identity families first and keeps every width inside the Archivo axis', () => {
		expect(tokens).toMatch(/--sp-face-display: 'Marcellus',/);
		expect(tokens).toMatch(/--sp-face-ui: 'Archivo Variable',/);

		const archivo = readFileSync(
			path.join(webRoot, 'node_modules/@fontsource-variable/archivo/wdth.css'),
			'utf8'
		);
		const axis = /font-stretch: (\d+(?:\.\d+)?)% (\d+(?:\.\d+)?)%/.exec(archivo);
		const widths = [...tokens.matchAll(/--sp-stretch-[a-z]+: (\d+(?:\.\d+)?)%/g)].map((m) =>
			Number(m[1])
		);

		expect(axis).not.toBeNull();
		expect(widths).toEqual([92, 88, 87.5, 85]);
		for (const width of widths) {
			expect(width).toBeGreaterThanOrEqual(Number(axis?.[1]));
			expect(width).toBeLessThanOrEqual(Number(axis?.[2]));
		}
	});

	it('never synthesises bold or italic from the single-weight display face', () => {
		expect(tokens).toMatch(/body \{[^}]*font-synthesis: none;/);
	});
});
