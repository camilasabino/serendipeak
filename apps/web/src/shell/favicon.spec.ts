import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const publicFile = (name: string) => readFileSync(resolve(__dirname, '../../public', name));
const svg = publicFile('favicon.svg').toString('utf8');

describe('favicon.svg', () => {
	it('keeps the light contours as the default and fallback', () => {
		expect(svg).toMatch(/\.contours\s*\{\s*fill:\s*#EEE6DF;\s*\}/i);
		expect(svg).toMatch(/class="contours"[^>]*fill="#EEE6DF"/i);
	});

	it('switches the contours to basalt on a light colour scheme only', () => {
		const rules = [...svg.matchAll(/@media\s*\(([^)]+)\)\s*\{([^}]*\{[^}]*\})\s*\}/g)];

		expect(rules).toHaveLength(1);
		expect(rules[0]![1]).toBe('prefers-color-scheme: light');
		expect(rules[0]![2]).toMatch(/\.contours\s*\{\s*fill:\s*#211D19;\s*\}/i);
	});

	it('leaves the summit triangle copper in both schemes', () => {
		expect(svg).toMatch(/<path fill="#DA9766" d=/);
		expect(svg.match(/#DA9766/gi)).toHaveLength(1);
	});

	it('is self-contained, transparent and unfiltered', () => {
		expect(svg).toContain('viewBox="0 0 1254 1254"');
		expect(svg).not.toMatch(/<image|href=|url\(|filter|<rect|@import|<script/i);
	});
});

describe('favicon.ico', () => {
	it('is the static fallback with 16, 32 and 48 px frames', () => {
		const ico = publicFile('favicon.ico');
		const count = ico.readUInt16LE(4);
		const sizes = Array.from({ length: count }, (_, i) => ico[6 + 16 * i]);

		expect(ico.readUInt16LE(0)).toBe(0);
		expect(ico.readUInt16LE(2)).toBe(1);
		expect(sizes).toEqual([16, 32, 48]);
	});
});
