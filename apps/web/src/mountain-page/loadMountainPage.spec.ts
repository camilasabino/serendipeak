import { describe, expect, it } from 'vitest';
import type { Mountain } from '../api/contract';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { contractFixture } from '../api/test-support/contractFixtures';
import { loadMountainPage } from './loadMountainPage';

const mountain = contractFixture('mountain-complete.json') as Mountain;

describe('loadMountainPage', () => {
	it('loads a found mountain as a 200 page without an explicit cache header', async () => {
		const api = new FakeMountainApi({ mountain: { kind: 'found', mountain } });

		const load = await loadMountainPage(api, mountain.slug);

		expect(load).toEqual({ model: { kind: 'mountain', mountain }, status: 200 });
		expect(load).not.toHaveProperty('cacheControl');
		expect(api.getMountainCalls).toEqual([mountain.slug]);
	});

	it('maps a missing mountain to 404', async () => {
		const api = new FakeMountainApi({ mountain: { kind: 'not-found' } });

		expect(await loadMountainPage(api, 'nowhere')).toEqual({
			model: { kind: 'error', reason: 'not-found' },
			status: 404
		});
	});

	it('maps an unreachable API to 503', async () => {
		const api = new FakeMountainApi({ mountain: { kind: 'unreachable' } });

		expect(await loadMountainPage(api, 'aconcagua')).toEqual({
			model: { kind: 'error', reason: 'unreachable' },
			status: 503
		});
	});

	it.each([
		['a backend 5xx', 500],
		['a malformed 2xx body', 200],
		['an unexpected 4xx', 418]
	])('maps %s to 502', async (_name, status) => {
		const api = new FakeMountainApi({ mountain: { kind: 'api-error', status } });

		expect(await loadMountainPage(api, 'aconcagua')).toEqual({
			model: { kind: 'error', reason: 'api-error' },
			status: 502
		});
	});

	it.each(['today', 'random'])(
		'resolves the reserved slug %s as not found without calling the API',
		async (slug) => {
			const api = new FakeMountainApi({ mountain: { kind: 'found', mountain } });

			const load = await loadMountainPage(api, slug);

			expect(load).toEqual({ model: { kind: 'error', reason: 'not-found' }, status: 404 });
			expect(api.getMountainCalls).toEqual([]);
			expect(api.getDailyMountainCalls).toBe(0);
			expect(api.getRandomMountainCalls).toEqual([]);
		}
	);

	it.each(['Today', 'random-peak', 'todays'])(
		'looks up %s because only the exact reserved words are excluded',
		async (slug) => {
			const api = new FakeMountainApi({ mountain: { kind: 'not-found' } });

			await loadMountainPage(api, slug);

			expect(api.getMountainCalls).toEqual([slug]);
		}
	);
});
