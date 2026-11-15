import { mountainHref } from '../explore/navigate';

const SITEMAP_NAMESPACE = 'http://www.sitemaps.org/schemas/sitemap/0.9';

// The public pages that exist independently of the catalog.
export const STATIC_SITEMAP_PATHS = ['/', '/atlas', '/about'] as const;

export function escapeXml(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&apos;');
}

/**
 * The paths a crawler should index: the static pages, then one page per slug. Slugs are sorted by
 * code unit rather than by locale so the order never depends on the server's ICU data, and
 * repeated slugs collapse to one entry.
 */
export function sitemapPaths(slugs: readonly string[]): string[] {
	const unique = [...new Set(slugs)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

	return [...STATIC_SITEMAP_PATHS, ...unique.map(mountainHref)];
}

// No lastmod, priority or changefreq: the index carries no trustworthy modification time, and a
// made-up one teaches crawlers to ignore the field.
export function buildSitemapXml(origin: string, slugs: readonly string[]): string {
	const entries = sitemapPaths(slugs).map(
		(path) => `  <url><loc>${escapeXml(`${origin}${path}`)}</loc></url>`
	);

	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		`<urlset xmlns="${SITEMAP_NAMESPACE}">`,
		...entries,
		'</urlset>',
		''
	].join('\n');
}
