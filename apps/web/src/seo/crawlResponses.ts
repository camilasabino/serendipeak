import type { MountainApi } from '../api/MountainApi';
import { readSiteOrigin, type SiteEnv } from '../config/siteOrigin';
import { buildRobotsTxt } from './robots';
import { buildSitemapXml } from './sitemap';

export interface CrawlResponse {
	status: number;
	headers: Record<string, string>;
	body: string;
}

// Shared caches may keep a document for the window; browsers always revalidate it. With the
// index requested fresh, five minutes is also the longest a rename or deactivation stays unseen.
export const CRAWL_CACHE_CONTROL = 'public, max-age=0, s-maxage=300';

const FAILURE_HEADERS = {
	'Content-Type': 'text/plain; charset=utf-8',
	'Cache-Control': 'no-store'
};

const MISCONFIGURED: CrawlResponse = {
	status: 500,
	headers: FAILURE_HEADERS,
	body: 'The sitemap is not available.\n'
};

// Retry-After is advisory: a crawler that saw this should come back, not drop the site.
const UNAVAILABLE: CrawlResponse = {
	status: 503,
	headers: { ...FAILURE_HEADERS, 'Retry-After': '300' },
	body: 'The sitemap is temporarily unavailable.\n'
};

export async function sitemapResponse(
	api: Pick<MountainApi, 'getMountainIndex'>,
	env: SiteEnv
): Promise<CrawlResponse> {
	const origin = readSiteOrigin(env);
	if (origin === undefined) {
		return MISCONFIGURED;
	}

	const result = await api.getMountainIndex({ fresh: true });
	if (result.kind !== 'found') {
		return UNAVAILABLE;
	}

	return {
		status: 200,
		headers: {
			'Content-Type': 'application/xml; charset=utf-8',
			'Cache-Control': CRAWL_CACHE_CONTROL
		},
		body: buildSitemapXml(
			origin,
			result.mountains.map((mountain) => mountain.slug)
		)
	};
}

export function robotsResponse(env: SiteEnv): CrawlResponse {
	return {
		status: 200,
		headers: {
			'Content-Type': 'text/plain; charset=utf-8',
			'Cache-Control': CRAWL_CACHE_CONTROL
		},
		body: buildRobotsTxt(readSiteOrigin(env))
	};
}
