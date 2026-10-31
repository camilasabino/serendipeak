import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvalidPublicConfigError } from '../config/readPublicConfig';
import { createBrowserMountainApi } from './browserMountainApi';
import { contractFixture } from './test-support/contractFixtures';
import { jsonResponse, stubFetch } from './test-support/stubFetch';

describe('createBrowserMountainApi', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
		vi.unstubAllGlobals();
	});

	it('can be created without a configured base URL, as when the 404 page is prerendered', () => {
		vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');

		expect(() => createBrowserMountainApi()).not.toThrow();
	});

	it('rejects a call, instead of guessing a URL, when the base URL is not configured', async () => {
		vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');

		await expect(createBrowserMountainApi().getRandomMountain('aconcagua')).rejects.toBeInstanceOf(
			InvalidPublicConfigError
		);
	});

	it('requests the random mountain from the configured API, excluding the current one', async () => {
		vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test/');
		const fetch = stubFetch(async () => jsonResponse(contractFixture('mountain-sparse.json')));
		vi.stubGlobal('fetch', fetch);

		const result = await createBrowserMountainApi().getRandomMountain('aconcagua');

		expect(result).toMatchObject({ kind: 'found', mountain: { slug: 'mount-olympus' } });
		expect(String(fetch.mock.calls[0]?.[0])).toBe(
			'http://api.test/api/v1/mountains/random?exclude=aconcagua'
		);
	});

	it('reads the base URL when it is first used and keeps the one API afterwards', async () => {
		const api = createBrowserMountainApi();
		vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
		const fetch = stubFetch(async () => jsonResponse(contractFixture('mountain-sparse.json')));
		vi.stubGlobal('fetch', fetch);

		await api.getRandomMountain();
		vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://elsewhere.test');
		await api.getMountain('mount-olympus');

		expect(String(fetch.mock.calls[1]?.[0])).toBe('http://api.test/api/v1/mountains/mount-olympus');
	});

	it('serves every MountainApi operation', async () => {
		vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test');
		const fetch = stubFetch(async () => jsonResponse(contractFixture('daily-mountain.json')));
		vi.stubGlobal('fetch', fetch);
		const api = createBrowserMountainApi();

		await expect(api.getDailyMountain()).resolves.toMatchObject({ kind: 'found' });
		expect(String(fetch.mock.calls[0]?.[0])).toBe('http://api.test/api/v1/mountains/today');
	});
});
