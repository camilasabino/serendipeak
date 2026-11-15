import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DailyMountain, Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import {
	BRAND_IMAGE_PATH,
	mountainDescription,
	socialDescriptorFor,
	socialTags
} from './socialMetadata';

const ORIGIN = 'https://serendipeak.example';
const complete = contractFixture('mountain-complete.json') as Mountain;
const minimal = contractFixture('mountain-minimal.json') as Mountain;
const daily = contractFixture('daily-mountain.json') as DailyMountain;

const publicDomain = {
	license: 'CC0 1.0',
	licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/'
};

function tagsOf(mountain: Mountain, origin: string | null = ORIGIN): string {
	const descriptor = socialDescriptorFor({ kind: 'mountain', mountain }, origin);

	return renderToStaticMarkup(<>{descriptor && socialTags(descriptor)}</>);
}

function contentOf(html: string, attribute: 'name' | 'property', key: string): string | undefined {
	const tag = new RegExp(`<meta ${attribute}="${key}" content="([^"]*)"`).exec(html);

	return tag?.[1]?.replaceAll('&amp;', '&');
}

describe('canonical URL', () => {
	it('is the absolute permanent address of the current slug', () => {
		const html = tagsOf({ ...complete, slug: 'aconcagua-renamed' });

		expect(html).toContain(`<link rel="canonical" href="${ORIGIN}/mountains/aconcagua-renamed"/>`);
		expect(contentOf(html, 'property', 'og:url')).toBe(`${ORIGIN}/mountains/aconcagua-renamed`);
	});

	it('is omitted, with the URLs derived from it, when no valid origin is configured', () => {
		const html = tagsOf(complete, null);

		expect(html).not.toContain('rel="canonical"');
		expect(html).not.toContain('og:url');
		expect(html).not.toContain(BRAND_IMAGE_PATH);
		expect(contentOf(html, 'property', 'og:title')).toBeDefined();
	});

	it('names the homepage, not the featured mountain, on the daily page', () => {
		const descriptor = socialDescriptorFor({ kind: 'daily', daily }, ORIGIN);

		expect(descriptor?.canonicalUrl).toBe(`${ORIGIN}/`);
	});
});

describe('private and failed pages', () => {
	it('publish no metadata for a preview', () => {
		expect(
			socialDescriptorFor({ kind: 'mountain', mountain: complete, preview: true }, ORIGIN)
		).toBeNull();
	});

	it.each(['not-found', 'unreachable', 'no-eligible-mountains', 'api-error'] as const)(
		'publish no metadata for %s',
		(reason) => {
			expect(socialDescriptorFor({ kind: 'error', reason }, ORIGIN)).toBeNull();
		}
	);
});

describe('daily page metadata', () => {
	it('is site-level and carries nothing of the day’s mountain', () => {
		const descriptor = socialDescriptorFor({ kind: 'daily', daily }, ORIGIN);
		const html = renderToStaticMarkup(<>{descriptor && socialTags(descriptor)}</>);

		expect(contentOf(html, 'property', 'og:title')).toBe('SerendiPeak');
		expect(contentOf(html, 'property', 'og:url')).toBe(`${ORIGIN}/`);
		expect(contentOf(html, 'property', 'og:image')).toBe(`${ORIGIN}${BRAND_IMAGE_PATH}`);
		expect(html).not.toContain(daily.mountain.name);
		expect(html).not.toContain(daily.mountain.slug);
	});
});

describe('mountain description', () => {
	it('is the curated summary', () => {
		expect(mountainDescription({ ...complete, summary: 'A tall  peak.\n' })).toBe('A tall peak.');
	});

	it('is cut at a word boundary with an ellipsis when long', () => {
		const description = mountainDescription({ ...complete, summary: 'word '.repeat(80) });

		expect(description.length).toBeLessThanOrEqual(200);
		expect(description).toMatch(/word…$/);
	});

	it('is built only from curated fields without a summary', () => {
		const description = mountainDescription({ ...complete, summary: undefined });

		expect(description).toBe(
			`${complete.name} rises 6,961 m in ${complete.region?.name}. Explore it in 3D on SerendiPeak.`
		);
	});

	it('falls back to the countries, then the continent', () => {
		const bare = { ...minimal, summary: undefined, region: null } as Mountain;

		expect(
			mountainDescription({ ...bare, countries: [{ code: 'AR', name: 'Argentina' }] })
		).toContain(' in Argentina.');
		expect(mountainDescription({ ...bare, countries: [] })).toContain(
			` in ${bare.continent.name}.`
		);
	});

	it('is deterministic', () => {
		expect(mountainDescription(complete)).toBe(mountainDescription(structuredClone(complete)));
	});
});

describe('social image', () => {
	it('falls back to the brand mark when the photograph needs attribution', () => {
		const html = tagsOf(complete);

		expect(contentOf(html, 'property', 'og:image')).toBe(`${ORIGIN}${BRAND_IMAGE_PATH}`);
		expect(contentOf(html, 'name', 'twitter:image')).toBe(`${ORIGIN}${BRAND_IMAGE_PATH}`);
		expect(contentOf(html, 'name', 'twitter:card')).toBe('summary');
		expect(contentOf(html, 'property', 'og:image:width')).toBe('1254');
	});

	it('uses a public-domain photograph as a wide card', () => {
		const html = tagsOf({
			...complete,
			primaryImage: {
				...complete.primaryImage!,
				...publicDomain,
				thumbnailUrl: 'https://media.example/page.jpg'
			}
		});

		expect(contentOf(html, 'property', 'og:image')).toBe('https://media.example/page.jpg');
		expect(contentOf(html, 'name', 'twitter:image')).toBe('https://media.example/page.jpg');
		expect(contentOf(html, 'name', 'twitter:card')).toBe('summary_large_image');
		expect(contentOf(html, 'property', 'og:image:alt')).toBe(`Photograph of ${complete.name}`);
		expect(html).not.toContain('og:image:width');
	});
});

describe('tags', () => {
	it('carry the title, description and site name of the page', () => {
		const html = tagsOf(complete);

		expect(contentOf(html, 'property', 'og:type')).toBe('website');
		expect(contentOf(html, 'property', 'og:site_name')).toBe('SerendiPeak');
		expect(contentOf(html, 'property', 'og:title')).toBe(`${complete.name} (6,961 m)`);
		expect(contentOf(html, 'name', 'description')).toBe(mountainDescription(complete));
		expect(contentOf(html, 'property', 'og:description')).toBe(mountainDescription(complete));
		expect(contentOf(html, 'name', 'twitter:title')).toBe(`${complete.name} (6,961 m)`);
	});

	it('all have keys, so client navigation replaces rather than duplicates them', () => {
		const descriptor = socialDescriptorFor({ kind: 'mountain', mountain: complete }, ORIGIN);

		expect(socialTags(descriptor!).every((tag) => tag.key !== null)).toBe(true);
	});
});
