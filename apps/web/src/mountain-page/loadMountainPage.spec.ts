import { describe, expect, it } from 'vitest';
import type { Mountain } from '../api/contract';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { contractFixture } from '../api/test-support/contractFixtures';
import { loadMountainPage } from './loadMountainPage';
import { isPermanentRedirect } from './pageModel';

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

	it.each([
		'today',
		'random',
		'.',
		'..',
		'Aconcagua',
		'mont blanc',
		'a--b',
		'-a',
		'a-',
		'monté',
		''
	])('resolves the slug %j as not found without calling the API', async (slug) => {
		const api = new FakeMountainApi({ mountain: { kind: 'found', mountain } });

		const load = await loadMountainPage(api, slug);

		expect(load).toEqual({ model: { kind: 'error', reason: 'not-found' }, status: 404 });
		expect(api.getMountainCalls).toEqual([]);
		expect(api.getDailyMountainCalls).toBe(0);
		expect(api.getRandomMountainCalls).toEqual([]);
	});

	it.each(['random-peak', 'todays', 'k2', 'mont-blanc'])(
		'looks up %s because only the exact reserved words are excluded',
		async (slug) => {
			const api = new FakeMountainApi({ mountain: { kind: 'not-found' } });

			await loadMountainPage(api, slug);

			expect(api.getMountainCalls).toEqual([slug]);
		}
	);

	describe('a slug the mountain used to have', () => {
		const renamed: Mountain = { ...mountain, slug: 'aconcagua-renamed' };

		it('redirects to the current address of the mountain', async () => {
			const api = new FakeMountainApi({ mountain: { kind: 'found', mountain: renamed } });

			const load = await loadMountainPage(api, 'aconcagua');

			expect(load).toEqual({
				destination: '/mountains/aconcagua-renamed',
				cacheControl: 'no-store'
			});
			expect(api.getMountainCalls).toEqual(['aconcagua']);
		});

		it('is not a page load, so no page is rendered for the old address', async () => {
			const api = new FakeMountainApi({ mountain: { kind: 'found', mountain: renamed } });

			expect(isPermanentRedirect(await loadMountainPage(api, 'aconcagua'))).toBe(true);
			expect(
				isPermanentRedirect(
					await loadMountainPage(
						new FakeMountainApi({ mountain: { kind: 'found', mountain } }),
						mountain.slug
					)
				)
			).toBe(false);
		});

		it('never builds a destination outside the mountain paths of this site', async () => {
			const api = new FakeMountainApi({
				mountain: { kind: 'found', mountain: { ...mountain, slug: '//evil.example' } }
			});

			const load = await loadMountainPage(api, 'aconcagua');

			expect(load).toEqual({
				destination: '/mountains/%2F%2Fevil.example',
				cacheControl: 'no-store'
			});
		});

		it('still maps an unknown slug and a failing API as before', async () => {
			expect(
				await loadMountainPage(new FakeMountainApi({ mountain: { kind: 'not-found' } }), 'old-peak')
			).toEqual({ model: { kind: 'error', reason: 'not-found' }, status: 404 });
			expect(
				await loadMountainPage(
					new FakeMountainApi({ mountain: { kind: 'unreachable' } }),
					'old-peak'
				)
			).toEqual({ model: { kind: 'error', reason: 'unreachable' }, status: 503 });
		});
	});
});
