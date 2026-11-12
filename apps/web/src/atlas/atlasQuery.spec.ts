import { describe, expect, it } from 'vitest';
import { legacyRedirect, legacySelection } from './atlasQuery';

const MOUNTAINS = [{ slug: 'cerro-torre' }, { slug: 'mont-blanc' }];

describe('legacySelection', () => {
	it.each([
		[{}, undefined],
		[{ mountain: '' }, undefined],
		[{ mountain: 'cerro-torre' }, 'cerro-torre'],
		[{ mountain: ['first', 'second'] }, 'first'],
		[{ mountain: '../today' }, '../today'],
		[{ other: 'x' }, undefined]
	])('reads %j as %j', (query, expected) => {
		expect(legacySelection(query)).toBe(expected);
	});
});

describe('legacyRedirect', () => {
	it('needs none for the bare atlas or an unrelated parameter', () => {
		expect(legacyRedirect({}, MOUNTAINS)).toBeUndefined();
		expect(legacyRedirect({ utm_source: 'mail' }, MOUNTAINS)).toBeUndefined();
	});

	it('sends a selected mountain to its own page', () => {
		expect(legacyRedirect({ mountain: 'cerro-torre' }, MOUNTAINS)).toBe('/mountains/cerro-torre');
	});

	it('sends a slug the atlas does not hold to the bare atlas', () => {
		for (const mountain of ['k2', '../today', 'cerro torre']) {
			expect(legacyRedirect({ mountain }, MOUNTAINS)).toBe('/atlas');
		}
	});

	it('encodes a known slug that needs it, so the destination stays one path segment', () => {
		expect(legacyRedirect({ mountain: 'a/b' }, [{ slug: 'a/b' }])).toBe('/mountains/a%2Fb');
	});

	it('never redirects the bare atlas it falls back to, so the redirect cannot loop', () => {
		const destination = legacyRedirect({ mountain: 'k2' }, MOUNTAINS)!;

		expect(
			legacyRedirect(Object.fromEntries(new URL(destination, 'http://x').searchParams), MOUNTAINS)
		).toBeUndefined();
	});

	it('leaves the URL alone while the catalog is unknown', () => {
		expect(legacyRedirect({ mountain: 'cerro-torre' }, undefined)).toBeUndefined();
	});
});
