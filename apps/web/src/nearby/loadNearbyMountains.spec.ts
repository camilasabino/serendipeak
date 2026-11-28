import { afterEach, describe, expect, it, vi } from 'vitest';
import { FakeMountainApi } from '../api/test-support/FakeMountainApi';
import { indexEntry } from '../api/test-support/indexEntries';
import { contractFixture } from '../api/test-support/contractFixtures';
import type { DailyMountain, Mountain, MountainIndexResult } from '../api/contract';
import { loadNearbyFor, loadNearbyMountains } from './loadNearbyMountains';

const here = { slug: 'here', coordinates: { latitude: 0, longitude: 0 } };
const neighbour = indexEntry('neighbour', 'Neighbour', {
	coordinates: { latitude: 1, longitude: 0 }
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('loadNearbyMountains', () => {
	it('asks the index once and answers with the neighbours', async () => {
		const api = new FakeMountainApi({ index: { kind: 'found', mountains: [neighbour] } });

		const found = await loadNearbyMountains(api, here);

		expect(found.map(({ slug }) => slug)).toEqual(['neighbour']);
		expect(api.getMountainIndexCalls).toBe(1);
	});

	it.each([
		['unreachable', { kind: 'unreachable' } as const],
		['an API error', { kind: 'api-error', status: 500 } as const]
	])('answers no neighbours when the index is %s', async (_name, index) => {
		expect(await loadNearbyMountains(new FakeMountainApi({ index }), here)).toEqual([]);
	});

	it('answers no neighbours, and reports it, when the request throws', async () => {
		const report = vi.spyOn(console, 'error').mockImplementation(() => {});
		const api = new FakeMountainApi();
		api.getMountainIndex = () => Promise.reject(new Error('boom'));

		expect(await loadNearbyMountains(api, here)).toEqual([]);
		expect(report).toHaveBeenCalledOnce();
	});
});

describe('loadNearbyFor', () => {
	const mountain = contractFixture('mountain-complete.json') as Mountain;
	const daily = contractFixture('daily-mountain.json') as DailyMountain;
	const next = indexEntry('next', 'Next', {
		coordinates: {
			latitude: mountain.coordinates.latitude + 0.5,
			longitude: mountain.coordinates.longitude
		}
	});
	const index: MountainIndexResult = {
		kind: 'found',
		mountains: [indexEntry(mountain.slug, mountain.name), next]
	};

	it('looks around the mountain of a permalink, excluding it', async () => {
		const found = await loadNearbyFor(new FakeMountainApi({ index }), {
			kind: 'mountain',
			mountain
		});

		expect(found.map(({ slug }) => slug)).toEqual(['next']);
	});

	it('looks around the mountain of the day, and excludes it', async () => {
		const api = new FakeMountainApi({
			index: {
				kind: 'found',
				mountains: [
					indexEntry(daily.mountain.slug, daily.mountain.name, {
						coordinates: daily.mountain.coordinates
					}),
					indexEntry('beside', 'Beside', { coordinates: daily.mountain.coordinates })
				]
			}
		});

		const found = await loadNearbyFor(api, { kind: 'daily', daily });

		expect(found.map(({ slug }) => slug)).toEqual(['beside']);
	});

	it('gives each mountain its own neighbours as the visitor moves between them', async () => {
		const api = new FakeMountainApi({
			index: {
				kind: 'found',
				mountains: [
					indexEntry('a', 'A', { coordinates: { latitude: 0, longitude: 0 } }),
					indexEntry('b', 'B', { coordinates: { latitude: 0, longitude: 1 } }),
					indexEntry('c', 'C', { coordinates: { latitude: 0, longitude: 60 } })
				]
			}
		});
		const around = async (slug: string, longitude: number) =>
			(await loadNearbyMountains(api, { slug, coordinates: { latitude: 0, longitude } })).map(
				({ slug: found }) => found
			);

		expect(await around('a', 0)).toEqual(['b']);
		expect(await around('b', 1)).toEqual(['a']);
		expect(await around('c', 60)).toEqual([]);
	});

	it('asks nothing for an error page', async () => {
		const api = new FakeMountainApi({ index });

		expect(await loadNearbyFor(api, { kind: 'error', reason: 'not-found' })).toEqual([]);
		expect(api.getMountainIndexCalls).toBe(0);
	});
});
