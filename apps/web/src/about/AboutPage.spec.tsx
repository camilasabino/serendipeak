import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { anchorsOf, countOf, hasEmptyElement, textsOf } from '../mountain-page/test-support/markup';
import { AboutPage } from './AboutPage';
import {
	ABOUT_DESCRIPTION,
	ABOUT_HEADING,
	ABOUT_LEDE,
	ABOUT_TITLE,
	TODAY_FEATURES,
	VISION_IDEAS,
	VISION_INTRO,
	VISION_NOTE_TITLE
} from './aboutCopy';

const html = renderToStaticMarkup(<AboutPage />);

describe('About page structure', () => {
	it('has one main landmark with a single h1', () => {
		expect(countOf(html, 'main')).toBe(1);
		expect(textsOf(html, 'h1')).toEqual([ABOUT_HEADING]);
	});

	it('orders the sections from what exists to what could exist, each named by an h2', () => {
		expect(textsOf(html, 'h2')).toEqual([
			'What you can do today',
			'Why it matters',
			'Where it could go'
		]);
	});

	it('labels every section by its heading', () => {
		const sections = [...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)];

		expect(sections).toHaveLength(3);
		for (const [, id] of sections) {
			expect(html).toMatch(new RegExp(`<h2 id="${id}"`));
		}
	});

	it('does not skip heading levels', () => {
		expect(countOf(html, 'h3')).toBe(0);
	});

	it('renders no empty elements and no images', () => {
		expect(hasEmptyElement(html)).toBe(false);
		expect(countOf(html, 'img')).toBe(0);
	});

	it('hides the decorative motif from assistive technology', () => {
		expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
	});
});

describe('About page content', () => {
	it('lists every current capability as a term with a description', () => {
		expect(textsOf(html, 'dt')).toEqual(TODAY_FEATURES.map(({ name }) => name));
		expect(textsOf(html, 'dd')).toEqual(TODAY_FEATURES.map(({ description }) => description));
	});

	it('keeps the future ideas apart from the current capabilities', () => {
		const today = html.slice(html.indexOf('<dl'), html.indexOf('</dl>'));
		const vision = html.slice(html.indexOf('about-vision'));

		for (const idea of VISION_IDEAS) {
			expect(vision).toContain(idea);
			expect(today).not.toContain(idea);
		}
		expect(vision).toContain(VISION_NOTE_TITLE);
		expect(textsOf(vision, 'li')).toEqual(VISION_IDEAS);
	});

	it('offers a way back to the daily mountain at the top and the bottom', () => {
		const links = anchorsOf(html).filter(({ href }) => href === '/');

		expect(links.map(({ text }) => text)).toEqual([
			"See today's mountain",
			"Back to today's mountain"
		]);
	});

	it('offers the atlas as a second call to action next to the daily mountain', () => {
		const intro = html.slice(0, html.indexOf('about-today'));

		expect(anchorsOf(intro).map(({ href, text }) => ({ href, text }))).toEqual([
			{ href: '/', text: "See today's mountain" },
			{ href: '/atlas', text: 'Explore the atlas' }
		]);
	});

	it('presents Today and the atlas as available features', () => {
		const names = TODAY_FEATURES.map(({ name }) => name);
		const atlas = TODAY_FEATURES.find(({ name }) => name === 'Atlas');

		expect(names).toEqual(expect.arrayContaining(['Today', 'Atlas']));
		expect(atlas?.description).toMatch(/continent/);
		expect(atlas?.description).toMatch(/full profile/);
	});

	it('no longer lists the atlas or continent browsing as a future possibility', () => {
		const vision = html.slice(html.indexOf('about-vision'));

		expect(VISION_INTRO).not.toMatch(/to become an evolving global mountain atlas/);
		expect(vision).not.toMatch(/by continent/i);
		expect(VISION_IDEAS.join(' ')).not.toMatch(/continent/i);
	});

	it('does not claim markers, on-globe selection, country browsing or a hardcoded mountain count', () => {
		const available = TODAY_FEATURES.map(({ description }) => description).join(' ');

		expect(available).not.toMatch(/marker|on the globe|country|range|nearby/i);
		expect(`${ABOUT_LEDE} ${ABOUT_DESCRIPTION} ${available}`).not.toMatch(/\d[\d,]*\s+mountains/);
	});

	it('links nowhere outside the site', () => {
		expect(anchorsOf(html).filter(({ href }) => /^https?:/.test(href))).toEqual([]);
	});
});

describe('About page metadata copy', () => {
	it('titles the page like every other page', () => {
		expect(ABOUT_TITLE).toBe('About · SerendiPeak');
	});

	it('describes the page within a search snippet', () => {
		expect(ABOUT_DESCRIPTION.length).toBeGreaterThan(50);
		expect(ABOUT_DESCRIPTION.length).toBeLessThanOrEqual(160);
	});
});

describe('About page boundaries', () => {
	const sources = ['AboutPage.tsx', 'aboutCopy.ts'].map((name) =>
		readFileSync(new URL(name, import.meta.url), 'utf8')
	);

	it('imports neither the 3D stage nor the API', () => {
		for (const source of sources) {
			expect(source).not.toMatch(/from\s+['"][^'"]*\/(stage|api)\//);
			expect(source).not.toMatch(/from\s+['"]cesium/);
		}
	});
});
