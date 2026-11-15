import type { GetServerSidePropsContext } from 'next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { indexEntry } from '../api/test-support/indexEntries';
import { getServerSideProps as robotsProps } from '../pages/robots.txt';
import { getServerSideProps as sitemapProps } from '../pages/sitemap.xml';

const api = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock('../api/serverMountainApi', () => ({
	createServerMountainApi: () => api.current
}));

function serve(props: typeof sitemapProps) {
	const res = { statusCode: 200, setHeader: vi.fn(), end: vi.fn() };

	return { res, result: props({ res } as unknown as GetServerSidePropsContext) };
}

beforeEach(() => {
	vi.stubEnv('SITE_ORIGIN', 'https://serendipeak.example');
	api.current = new FakeMountainApi({
		index: { kind: 'found', mountains: [indexEntry('aconcagua', 'Aconcagua')] }
	});
});

afterEach(() => {
	vi.unstubAllEnvs();
});

describe('the sitemap route', () => {
	it('writes the sitemap itself and renders no page', async () => {
		const { res, result } = serve(sitemapProps);

		expect(await result).toEqual({ props: {} });
		expect(res.statusCode).toBe(200);
		expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/xml; charset=utf-8');
		expect(res.end).toHaveBeenCalledWith(
			expect.stringContaining('<loc>https://serendipeak.example/mountains/aconcagua</loc>')
		);
	});

	it('reports a missing origin as an uncacheable server error', async () => {
		vi.stubEnv('SITE_ORIGIN', '');
		const { res, result } = serve(sitemapProps);
		await result;

		expect(res.statusCode).toBe(500);
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
	});

	it('reports an unavailable API as an uncacheable 503', async () => {
		api.current = new FakeMountainApi({ index: { kind: 'unreachable' } });
		const { res, result } = serve(sitemapProps);
		await result;

		expect(res.statusCode).toBe(503);
		expect(res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
	});
});

describe('the robots route', () => {
	it('writes the plain-text rules and the sitemap directive', async () => {
		const { res, result } = serve(robotsProps);

		expect(await result).toEqual({ props: {} });
		expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/plain; charset=utf-8');
		expect(res.end).toHaveBeenCalledWith(
			expect.stringContaining('Sitemap: https://serendipeak.example/sitemap.xml')
		);
	});
});
