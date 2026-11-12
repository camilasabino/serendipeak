import { describe, expect, it } from 'vitest';
import { mountainIndexEntry } from '../../e2e/stub-api/serendipeak-contract.mjs';
import { HttpMountainApi } from './HttpMountainApi';
import { isMountainIndex } from './schema';
import { contractFixture, MOUNTAIN_FIXTURES } from './test-support/contractFixtures';
import {
	BASE_URL,
	requestedInit,
	requestedUrl,
	serving,
	stubFetch
} from './test-support/stubFetch';

const entries = MOUNTAIN_FIXTURES.map((name) =>
	mountainIndexEntry(contractFixture(name) as object)
);
const index = { mountains: entries };

function apiServing(body: unknown, status = 200) {
	const fetch = serving(body, status);
	return { fetch, api: new HttpMountainApi({ baseUrl: BASE_URL, fetch }) };
}

function withEntry(changes: Record<string, unknown>) {
	return { mountains: [{ ...entries[0], ...changes }] };
}

describe('isMountainIndex', () => {
	it('accepts the index built from every contract mountain', () => {
		expect(isMountainIndex(index)).toBe(true);
	});

	it('accepts an empty index', () => {
		expect(isMountainIndex({ mountains: [] })).toBe(true);
	});

	it.each([
		['no body', undefined],
		['a bare list', entries],
		['no mountains member', {}],
		['mountains that are not a list', { mountains: {} }]
	])('rejects %s', (_name, body) => {
		expect(isMountainIndex(body)).toBe(false);
	});

	it.each([
		['an invalid slug', { slug: 'Not A Slug' }],
		['a reserved slug', { slug: 'today' }],
		['an empty name', { name: '' }],
		['coordinates out of range', { coordinates: { latitude: 91, longitude: 0 } }],
		['a non-positive elevation', { elevationMeters: 0 }],
		['an unknown continent', { continent: { code: 'XX', name: 'Nowhere' } }],
		['repeated countries', { countries: [entries[0]?.countries, entries[0]?.countries].flat() }],
		['a missing region', { region: undefined }]
	])('rejects an entry with %s', (_name, changes) => {
		expect(isMountainIndex(withEntry(changes))).toBe(false);
	});

	it('accepts an entry without region or countries', () => {
		expect(isMountainIndex(withEntry({ region: null, countries: [] }))).toBe(true);
	});

	it('rejects an index that lists one slug twice', () => {
		expect(isMountainIndex({ mountains: [entries[0], entries[0]] })).toBe(false);
	});
});

describe('HttpMountainApi.getMountainIndex', () => {
	it('requests the index endpoint and lets the browser reuse a cached answer', async () => {
		const { api, fetch } = apiServing(index);

		await api.getMountainIndex();

		expect(requestedUrl(fetch)).toBe('http://api.test/api/v1/mountains');
		expect(requestedInit(fetch).cache).toBeUndefined();
	});

	it('returns the entries of a valid index unchanged', async () => {
		expect(await apiServing(index).api.getMountainIndex()).toEqual({
			kind: 'found',
			mountains: entries
		});
	});

	it('returns an empty catalog as found with no mountains', async () => {
		expect(await apiServing({ mountains: [] }).api.getMountainIndex()).toEqual({
			kind: 'found',
			mountains: []
		});
	});

	it.each([
		['a server error', { error: { code: 'INTERNAL_ERROR', message: 'x' } }, 500],
		['a malformed body', { unexpected: true }, 200],
		['an invalid entry', withEntry({ slug: '' }), 200],
		['a not-found answer', { error: { code: 'MOUNTAIN_NOT_FOUND', message: 'x' } }, 404]
	])('reports %s as an API error with its status', async (_name, body, status) => {
		expect(await apiServing(body, status).api.getMountainIndex()).toEqual({
			kind: 'api-error',
			status
		});
	});

	it('reports a network failure as unreachable', async () => {
		const fetch = stubFetch(async () => {
			throw new TypeError('Failed to fetch');
		});

		expect(await new HttpMountainApi({ baseUrl: BASE_URL, fetch }).getMountainIndex()).toEqual({
			kind: 'unreachable'
		});
	});
});
