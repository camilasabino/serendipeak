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
});
