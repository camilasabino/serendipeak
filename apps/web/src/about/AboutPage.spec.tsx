import { existsSync, readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { anchorsOf, countOf, hasEmptyElement, textsOf } from '../mountain-page/test-support/markup';
import { SITE_TAGLINE } from '../mountain-page/pageCopy';
import { AboutPage } from './AboutPage';
import {
	ABOUT_DESCRIPTION,
	ABOUT_HEADING,
	ABOUT_LEDE_PARAGRAPHS,
	ABOUT_TITLE,
	BEHIND_AUTHOR,
	BEHIND_AUTHOR_URL,
	BEHIND_HEADING,
	BEHIND_PARAGRAPHS,
	BEHIND_PHOTOS,
	EXPERIENCE_BLOCKS,
	LOVE_PARAGRAPHS
} from './aboutCopy';

const html = renderToStaticMarkup(<AboutPage />);

describe('About page structure', () => {
	it('has one main landmark with a single h1', () => {
		expect(countOf(html, 'main')).toBe(1);
		expect(textsOf(html, 'h1')).toEqual([ABOUT_HEADING]);
	});

	it('names each section with an h2', () => {
		expect(textsOf(html, 'h2')).toEqual([
			'Discover. Explore. Wander.',
			'For the love of mountains',
			BEHIND_HEADING
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

	it('renders no empty elements', () => {
		expect(hasEmptyElement(html)).toBe(false);
	});

	it('hides the decorative motif from assistive technology', () => {
		expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
	});
});

describe('About page content', () => {
	it('presents three experience blocks as terms with descriptions', () => {
		expect(EXPERIENCE_BLOCKS).toHaveLength(3);
		expect(textsOf(html, 'dt')).toEqual(EXPERIENCE_BLOCKS.map(({ name }) => name));
		expect(textsOf(html, 'dd')).toEqual(EXPERIENCE_BLOCKS.map(({ description }) => description));
	});

	it('renders the hero and love-of-mountains paragraphs', () => {
		expect(textsOf(html, 'p')).toEqual(
			expect.arrayContaining([...ABOUT_LEDE_PARAGRAPHS, ...LOVE_PARAGRAPHS])
		);
	});

	it('uses the site tagline as its heading and ends after the last section', () => {
		expect(ABOUT_HEADING).toBe(SITE_TAGLINE);
		expect(SITE_TAGLINE).toBe('A world of mountains to explore.');
		expect(html).not.toMatch(
			/Where it could go|Possibilities|Tomorrow, another|Somewhere on Earth/
		);
		expect(html.trimEnd().endsWith('</main>')).toBe(true);
		expect(html.slice(html.lastIndexOf('</section>'))).toBe('</section></div></main>');
	});

	it('offers a way back to the daily mountain in the introduction only', () => {
		const links = anchorsOf(html).filter(({ href }) => href === '/');

		expect(links.map(({ text }) => text)).toEqual(["See today's mountain"]);
	});

	it('offers the atlas as a second call to action next to the daily mountain', () => {
		const intro = html.slice(0, html.indexOf('about-experience'));

		expect(anchorsOf(intro).map(({ href, text }) => ({ href, text }))).toEqual([
			{ href: '/', text: "See today's mountain" },
			{ href: '/atlas', text: 'Explore the atlas' }
		]);
	});

	it('does not claim unimplemented features or a hardcoded mountain count', () => {
		const copy = [...ABOUT_LEDE_PARAGRAPHS, ...LOVE_PARAGRAPHS, ABOUT_DESCRIPTION].join(' ');

		expect(copy).not.toMatch(/\d[\d,]*\s+mountains/);
		expect(copy).not.toMatch(/route|track|planning/i);
	});

	it('links outside the site only to the author, safely and from within the story', () => {
		const external = anchorsOf(html).filter(({ href }) => /^https?:/.test(href));

		expect(external.map(({ href, text }) => ({ href, text }))).toEqual([
			{ href: BEHIND_AUTHOR_URL, text: BEHIND_AUTHOR }
		]);
		expect(external[0]?.attributes).toContain('rel="external noopener noreferrer"');
		expect(html.indexOf(BEHIND_AUTHOR_URL)).toBeGreaterThan(html.indexOf('about-behind'));
	});
});

describe('About page personal section', () => {
	const section = html.slice(html.lastIndexOf('<section'));
	const photos = BEHIND_PHOTOS;

	it('tells the story in the first person with the approved paragraphs', () => {
		expect(BEHIND_PARAGRAPHS).toHaveLength(3);
		expect(textsOf(section, 'p')).toEqual(['Behind SerendiPeak', ...BEHIND_PARAGRAPHS]);
	});

	it('shows three equally sized photographs below the fold with described, size-reserving images', () => {
		const images = [...section.matchAll(/<img\s[^>]*>/g)].map(([tag]) => tag);

		expect(images).toHaveLength(3);
		expect(new Set(photos.map(({ width, height }) => `${width}x${height}`)).size).toBe(1);
		expect(html.slice(0, html.indexOf('about-behind'))).not.toContain('<img');
		for (const [index, tag] of images.entries()) {
			const photo = photos[index]!;

			expect(tag).toContain('loading="lazy"');
			expect(tag).toContain(`width="${photo.width}"`);
			expect(tag).toContain(`height="${photo.height}"`);
			expect(tag).toContain('alt="');
			expect(photo.alt.length).toBeGreaterThan(40);
		}
	});

	it('serves every referenced derivative from public/about without local paths', () => {
		for (const { src, srcSet } of photos) {
			const files = [src, ...srcSet.split(',').map((entry) => entry.trim().split(' ')[0]!)];

			for (const file of files) {
				expect(file).toMatch(/^\/about\/[a-z0-9-]+\.webp$/);
				expect(existsSync(new URL(`../../public${file}`, import.meta.url))).toBe(true);
			}
		}
		expect(html).not.toMatch(/Downloads|PSX_|\/Users\//);
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
