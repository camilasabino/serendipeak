import { describe, expect, it } from 'vitest';
import { indexEntry } from '../api/test-support/indexEntries';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { loadAtlasPage } from './loadAtlasPage';

describe('loadAtlasPage', () => {
	it('serves every mountain of the index with 200 and no cache directive of its own', async () => {
		const mountains = [indexEntry('aconcagua', 'Aconcagua')];
		const api = new FakeMountainApi({ index: { kind: 'found', mountains } });

		await expect(loadAtlasPage(api)).resolves.toEqual({
			model: { kind: 'atlas', mountains },
			status: 200
		});
		expect(api.getMountainIndexCalls).toBe(1);
	});

	it('serves an empty catalog as an atlas, not as an error', async () => {
		const api = new FakeMountainApi({ index: { kind: 'found', mountains: [] } });

		await expect(loadAtlasPage(api)).resolves.toMatchObject({
			model: { kind: 'atlas', mountains: [] },
			status: 200
		});
	});

	it.each([
		[{ kind: 'unreachable' } as const, 503],
		[{ kind: 'api-error', status: 500 } as const, 502]
	])('classifies a %j index as a failure', async (index, status) => {
		const load = await loadAtlasPage(new FakeMountainApi({ index }));

		expect(load).toEqual({ model: { kind: 'error', reason: index.kind }, status });
	});
});
