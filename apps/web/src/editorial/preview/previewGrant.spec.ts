import { describe, expect, it } from 'vitest';
import { MAX_TOKEN_LENGTH, parsePreviewFragment, parsePreviewGrant } from './previewGrant';

const TOKEN = 'eyJtb3VudGFpbiI6IjEifQ:1vHk2x:abc-DEF_123';

describe('parsePreviewGrant', () => {
	it('accepts a token of the signer alphabet with a valid slug', () => {
		expect(parsePreviewGrant({ token: TOKEN, slug: 'draft-peak' })).toEqual({
			token: TOKEN,
			slug: 'draft-peak'
		});
	});

	it.each([
		['nothing', undefined],
		['null', null],
		['a string', 'token'],
		['no token', { slug: 'draft-peak' }],
		['an empty token', { token: '', slug: 'draft-peak' }],
		['a non-string token', { token: 12, slug: 'draft-peak' }],
		['a token with a space', { token: 'a b', slug: 'draft-peak' }],
		['a token with a line break', { token: 'abc\r\nX-Injected: 1', slug: 'draft-peak' }],
		['a token with a slash', { token: 'a/b', slug: 'draft-peak' }],
		['an oversized token', { token: 'a'.repeat(MAX_TOKEN_LENGTH + 1), slug: 'draft-peak' }],
		['no slug', { token: TOKEN }],
		['a path as slug', { token: TOKEN, slug: '../admin' }],
		['an absolute URL as slug', { token: TOKEN, slug: 'https://evil.example' }],
		['an uppercase slug', { token: TOKEN, slug: 'Draft-Peak' }],
		['a reserved slug', { token: TOKEN, slug: 'today' }]
	])('refuses %s', (_name, value) => {
		expect(parsePreviewGrant(value)).toBeUndefined();
	});

	it('accepts a token at the size limit', () => {
		const token = 'a'.repeat(MAX_TOKEN_LENGTH);

		expect(parsePreviewGrant({ token, slug: 'draft-peak' })?.token).toBe(token);
	});
});

describe('parsePreviewFragment', () => {
	it('reads the token and the slug from the fragment', () => {
		expect(parsePreviewFragment(`#token=${TOKEN}&slug=draft-peak`)).toEqual({
			token: TOKEN,
			slug: 'draft-peak'
		});
	});

	it('reads a fragment without the leading hash', () => {
		expect(parsePreviewFragment(`slug=draft-peak&token=${TOKEN}`)?.slug).toBe('draft-peak');
	});

	it.each(['', '#', '#token=abc', '#slug=draft-peak', `#token=${TOKEN}&slug=a%2Fb`])(
		'refuses %j',
		(hash) => {
			expect(parsePreviewFragment(hash)).toBeUndefined();
		}
	);

	it('decodes a percent-encoded colon in the token', () => {
		expect(parsePreviewFragment('#token=a%3Ab&slug=draft-peak')?.token).toBe('a:b');
	});
});
