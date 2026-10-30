import { describe, expect, it, vi } from 'vitest';
import { readPublicConfig } from '../config/readPublicConfig';
import { DEFAULT_TIMEOUT_MS, HttpMountainApi } from './HttpMountainApi';
import { contractFixture } from './test-support/contractFixtures';
import {
	BASE_URL,
	jsonResponse,
	requestedInit,
	requestedUrl,
	serving,
	stubFetch
} from './test-support/stubFetch';

const mountain = contractFixture('mountain-complete.json');
const daily = contractFixture('daily-mountain.json');

function hangingUntilAborted() {
	return stubFetch(
		(_input, init) =>
			new Promise<Response>((_, reject) => {
				init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
			})
	);
}

describe('HttpMountainApi requests', () => {
	it('requests the permalink endpoint under the configured base URL', async () => {
		const fetch = serving(mountain);
		const { apiBaseUrl } = readPublicConfig({ NEXT_PUBLIC_API_BASE_URL: 'http://api.test///' });

		await new HttpMountainApi({ baseUrl: apiBaseUrl, fetch }).getMountain('aconcagua');

		expect(requestedUrl(fetch)).toBe('http://api.test/api/v1/mountains/aconcagua');
		expect(fetch).toHaveBeenCalledTimes(1);
	});

	it('does not double the slash when the base URL keeps its trailing slashes', async () => {
		const fetch = serving(mountain);

		await new HttpMountainApi({ baseUrl: 'http://api.test//', fetch }).getMountain('aconcagua');

		expect(requestedUrl(fetch)).toBe('http://api.test/api/v1/mountains/aconcagua');
	});

	it('keeps a base URL path prefix', async () => {
		const fetch = serving(mountain);

		await new HttpMountainApi({ baseUrl: 'http://api.test/proxy/', fetch }).getMountain(
			'aconcagua'
		);

		expect(requestedUrl(fetch)).toBe('http://api.test/proxy/api/v1/mountains/aconcagua');
	});

	it('keeps the slug inside one path segment', async () => {
		const fetch = serving(mountain);

		await new HttpMountainApi({ baseUrl: BASE_URL, fetch }).getMountain(
			'Mount Fuji/../today?x=1#y'
		);

		expect(requestedUrl(fetch)).toBe(
			'http://api.test/api/v1/mountains/Mount%20Fuji%2F..%2Ftoday%3Fx%3D1%23y'
		);
	});

	it('requests the today endpoint with no-store', async () => {
		const fetch = serving(daily);

		await new HttpMountainApi({ baseUrl: BASE_URL, fetch }).getDailyMountain();

		expect(requestedUrl(fetch)).toBe('http://api.test/api/v1/mountains/today');
		expect(requestedInit(fetch).cache).toBe('no-store');
	});

	it('requests the random endpoint with no-store and without a query by default', async () => {
		const fetch = serving(mountain);

		await new HttpMountainApi({ baseUrl: BASE_URL, fetch }).getRandomMountain();

		expect(requestedUrl(fetch)).toBe('http://api.test/api/v1/mountains/random');
		expect(requestedInit(fetch).cache).toBe('no-store');
	});

	it('encodes the excluded slug as a query value', async () => {
		const fetch = serving(mountain);

		await new HttpMountainApi({ baseUrl: BASE_URL, fetch }).getRandomMountain('a&b=c d');

		expect(requestedUrl(fetch)).toBe(
			'http://api.test/api/v1/mountains/random?exclude=a%26b%3Dc%20d'
		);
	});

	it('leaves the permalink request cache mode to the caller', async () => {
		const fetch = serving(mountain);

		await new HttpMountainApi({ baseUrl: BASE_URL, fetch }).getMountain('aconcagua');

		expect(requestedInit(fetch).cache).toBeUndefined();
	});

	it('falls back to the global fetch bound to the global object', async () => {
		const globalFetch = vi.fn<typeof globalThis.fetch>(async function (this: unknown) {
			expect(this).toBe(globalThis);
			return jsonResponse(mountain);
		});
		vi.stubGlobal('fetch', globalFetch);

		try {
			const result = await new HttpMountainApi({ baseUrl: BASE_URL }).getMountain('aconcagua');

			expect(result.kind).toBe('found');
			expect(globalFetch).toHaveBeenCalledTimes(1);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe('HttpMountainApi failures', () => {
	it('returns unreachable when the request rejects', async () => {
		const api = new HttpMountainApi({
			baseUrl: BASE_URL,
			fetch: stubFetch(async () => {
				throw new TypeError('fetch failed');
			})
		});

		expect(await api.getMountain('aconcagua')).toEqual({ kind: 'unreachable' });
		expect(await api.getDailyMountain()).toEqual({ kind: 'unreachable' });
		expect(await api.getRandomMountain()).toEqual({ kind: 'unreachable' });
	});

	it('returns unreachable when the connection breaks while the body streams', async () => {
		const brokenBody = new ReadableStream({
			start(controller) {
				controller.error(new TypeError('terminated'));
			}
		});
		const api = new HttpMountainApi({
			baseUrl: BASE_URL,
			fetch: stubFetch(async () => new Response(brokenBody, { status: 200 }))
		});

		expect(await api.getMountain('aconcagua')).toEqual({ kind: 'unreachable' });
	});

	it('arms a signal with the default timeout of five seconds', async () => {
		const fetch = serving(mountain);

		await new HttpMountainApi({ baseUrl: BASE_URL, fetch }).getMountain('aconcagua');

		expect(DEFAULT_TIMEOUT_MS).toBe(5_000);
		expect(requestedInit(fetch).signal).toBeInstanceOf(AbortSignal);
		expect(requestedInit(fetch).signal?.aborted).toBe(false);
	});

	it('returns unreachable when the server does not answer within the timeout', async () => {
		const api = new HttpMountainApi({
			baseUrl: BASE_URL,
			fetch: hangingUntilAborted(),
			timeoutMs: 20
		});

		expect(await api.getMountain('aconcagua')).toEqual({ kind: 'unreachable' });
		expect(await api.getDailyMountain()).toEqual({ kind: 'unreachable' });
		expect(await api.getRandomMountain()).toEqual({ kind: 'unreachable' });
	});

	it('returns unreachable when the body stalls past the timeout', async () => {
		const api = new HttpMountainApi({
			baseUrl: BASE_URL,
			timeoutMs: 20,
			fetch: stubFetch(async (_input, init) => {
				const stalledBody = new ReadableStream({
					start(controller) {
						init?.signal?.addEventListener('abort', () => controller.error(init.signal?.reason));
					}
				});
				return new Response(stalledBody, { status: 200 });
			})
		});

		expect(await api.getMountain('aconcagua')).toEqual({ kind: 'unreachable' });
	});

	it('rejects a timeout that is not a positive number', () => {
		for (const timeoutMs of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
			expect(() => new HttpMountainApi({ baseUrl: BASE_URL, timeoutMs })).toThrow(RangeError);
		}
	});

	it('returns an api-error with the status for a non-JSON error page', async () => {
		const api = new HttpMountainApi({
			baseUrl: BASE_URL,
			fetch: stubFetch(async () => new Response('<html>Bad gateway</html>', { status: 502 }))
		});

		expect(await api.getMountain('aconcagua')).toEqual({ kind: 'api-error', status: 502 });
		expect(await api.getDailyMountain()).toEqual({ kind: 'api-error', status: 502 });
		expect(await api.getRandomMountain()).toEqual({ kind: 'api-error', status: 502 });
	});

	it('does not read a 404 without the contract envelope as not-found', async () => {
		const api = new HttpMountainApi({
			baseUrl: BASE_URL,
			fetch: stubFetch(async () => new Response('404 page not found', { status: 404 }))
		});

		expect(await api.getMountain('aconcagua')).toEqual({ kind: 'api-error', status: 404 });
	});

	it('returns an api-error with status 200 when a successful body is not JSON', async () => {
		const api = new HttpMountainApi({
			baseUrl: BASE_URL,
			fetch: stubFetch(async () => new Response('<html></html>', { status: 200 }))
		});

		expect(await api.getMountain('aconcagua')).toEqual({ kind: 'api-error', status: 200 });
		expect(await api.getDailyMountain()).toEqual({ kind: 'api-error', status: 200 });
		expect(await api.getRandomMountain()).toEqual({ kind: 'api-error', status: 200 });
	});

	it('returns an api-error with status 200 when a successful body has the wrong shape', async () => {
		const wrongShape = [
			{ slug: 'aconcagua' },
			[],
			null,
			'aconcagua',
			{ ...(mountain as object), countries: undefined },
			{ ...(mountain as object), summary: null },
			{ ...(mountain as object), camera: { headingDegrees: 10 } }
		];

		for (const body of wrongShape) {
			const api = new HttpMountainApi({ baseUrl: BASE_URL, fetch: serving(body) });

			expect(await api.getMountain('aconcagua'), JSON.stringify(body)).toEqual({
				kind: 'api-error',
				status: 200
			});
			expect(await api.getRandomMountain(), JSON.stringify(body)).toEqual({
				kind: 'api-error',
				status: 200
			});
		}
	});

	it('returns an api-error for a daily payload without a valid date or mountain', async () => {
		const payload = daily as { date: string; mountain: unknown };
		const malformed = [
			payload.mountain,
			{ mountain: payload.mountain },
			{ date: '2026-02-30', mountain: payload.mountain },
			{ date: '2026-10-12', mountain: { slug: 'aconcagua' } },
			{ date: '2026-10-12' }
		];

		for (const body of malformed) {
			const api = new HttpMountainApi({ baseUrl: BASE_URL, fetch: serving(body) });

			expect(await api.getDailyMountain(), JSON.stringify(body)).toEqual({
				kind: 'api-error',
				status: 200
			});
		}
	});
});
