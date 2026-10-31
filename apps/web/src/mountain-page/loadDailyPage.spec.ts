import { describe, expect, it } from 'vitest';
import type { DailyMountain } from '../api/contract';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { contractFixture } from '../api/test-support/contractFixtures';
import { loadDailyPage } from './loadDailyPage';

const daily = contractFixture('daily-mountain.json') as DailyMountain;

describe('loadDailyPage', () => {
	it("loads today's mountain as a 200 page that shared caches must not store", async () => {
		const api = new FakeMountainApi({ daily: { kind: 'found', daily } });

		expect(await loadDailyPage(api)).toEqual({
			model: { kind: 'daily', daily },
			status: 200,
			cacheControl: 'no-store'
		});
		expect(api.getDailyMountainCalls).toBe(1);
	});

	it('maps no eligible mountains to 503', async () => {
		const api = new FakeMountainApi({ daily: { kind: 'no-eligible-mountains' } });

		expect(await loadDailyPage(api)).toEqual({
			model: { kind: 'error', reason: 'no-eligible-mountains' },
			status: 503,
			cacheControl: 'no-store'
		});
	});

	it('maps an unreachable API to 503', async () => {
		const api = new FakeMountainApi({ daily: { kind: 'unreachable' } });

		expect(await loadDailyPage(api)).toEqual({
			model: { kind: 'error', reason: 'unreachable' },
			status: 503,
			cacheControl: 'no-store'
		});
	});

	it.each([
		['a backend 5xx', 500],
		['a malformed 2xx body', 200]
	])('maps %s to 502', async (_name, status) => {
		const api = new FakeMountainApi({ daily: { kind: 'api-error', status } });

		expect(await loadDailyPage(api)).toEqual({
			model: { kind: 'error', reason: 'api-error' },
			status: 502,
			cacheControl: 'no-store'
		});
	});

	it('never asks for a permalink or a random mountain', async () => {
		const api = new FakeMountainApi({ daily: { kind: 'found', daily } });

		await loadDailyPage(api);

		expect(api.getMountainCalls).toEqual([]);
		expect(api.getRandomMountainCalls).toEqual([]);
	});
});
