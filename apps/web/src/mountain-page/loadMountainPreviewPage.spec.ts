import { describe, expect, it } from 'vitest';
import type { Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { loadMountainPreviewPage } from './loadMountainPreviewPage';

const mountain = contractFixture('mountain-complete.json') as Mountain;
const grant = { token: 'abc:def', slug: mountain.slug };

describe('loadMountainPreviewPage', () => {
	it('serves the draft as a private, unindexed preview and never asks for the public page', async () => {
		const api = new FakeMountainApi({ preview: { kind: 'found', mountain } });

		const load = await loadMountainPreviewPage(api, mountain.slug, grant);

		expect(load).toEqual({
			model: { kind: 'mountain', mountain, preview: true },
			status: 200,
			cacheControl: 'private, no-store',
			noindex: true
		});
		expect(api.getMountainPreviewCalls).toEqual(['abc:def']);
		expect(api.getMountainCalls).toEqual([]);
	});

	it('serves the public page when the cookie holds no usable grant', async () => {
		const api = new FakeMountainApi({ mountain: { kind: 'found', mountain } });

		const load = await loadMountainPreviewPage(api, mountain.slug, undefined);

		expect(load.model).toEqual({ kind: 'mountain', mountain });
		expect(load).not.toHaveProperty('noindex');
		expect(api.getMountainPreviewCalls).toEqual([]);
	});

	it('does not spend the token on a page it was not made for', async () => {
		const api = new FakeMountainApi({
			preview: { kind: 'found', mountain },
			mountain: { kind: 'not-found' }
		});

		const load = await loadMountainPreviewPage(api, 'other-peak', grant);

		expect(api.getMountainPreviewCalls).toEqual([]);
		expect(api.getMountainCalls).toEqual(['other-peak']);
		expect(load.model).toEqual({ kind: 'error', reason: 'not-found' });
	});

	it('falls back to the public page when the preview answers for another slug', async () => {
		const renamed = { ...mountain, slug: 'renamed-peak' };
		const api = new FakeMountainApi({
			preview: { kind: 'found', mountain: renamed },
			mountain: { kind: 'not-found' }
		});

		const load = await loadMountainPreviewPage(api, mountain.slug, grant);

		expect(load.model).toEqual({ kind: 'error', reason: 'not-found' });
		expect(load).not.toHaveProperty('noindex');
	});

	it.each([
		['refused', { kind: 'api-error', status: 401 }],
		['gone', { kind: 'not-found' }],
		['unreachable', { kind: 'unreachable' }]
	] as const)('falls back to the public page when the preview is %s', async (_name, preview) => {
		const api = new FakeMountainApi({ preview, mountain: { kind: 'not-found' } });

		const load = await loadMountainPreviewPage(api, mountain.slug, grant);

		expect(load.model).toEqual({ kind: 'error', reason: 'not-found' });
		expect(load.status).toBe(404);
		expect(api.getMountainCalls).toEqual([mountain.slug]);
	});
});
