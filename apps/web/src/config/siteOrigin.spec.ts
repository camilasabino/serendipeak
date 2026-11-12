import { describe, expect, it, vi } from 'vitest';
import { canonicalUrl, readSiteOrigin } from './siteOrigin';

describe('readSiteOrigin', () => {
	it.each([
		['https://serendipeak.example', 'https://serendipeak.example'],
		['https://serendipeak.example/', 'https://serendipeak.example'],
		['  http://127.0.0.1:3100  ', 'http://127.0.0.1:3100']
	])('accepts the bare origin %j', (value, origin) => {
		expect(readSiteOrigin({ SITE_ORIGIN: value })).toBe(origin);
	});

	it.each([undefined, '', '   '])('publishes nothing for the unset value %j', (value) => {
		const warn = vi.fn();

		expect(readSiteOrigin({ SITE_ORIGIN: value }, warn)).toBeUndefined();
		expect(warn).not.toHaveBeenCalled();
	});

	it.each(['not a url', 'ftp://serendipeak.example', 'https://serendipeak.example/atlas'])(
		'reports and ignores the malformed value %j',
		(value) => {
			const warn = vi.fn();

			expect(readSiteOrigin({ SITE_ORIGIN: value }, warn)).toBeUndefined();
			expect(warn).toHaveBeenCalledOnce();
		}
	);
});

describe('canonicalUrl', () => {
	it('is absolute on the configured origin, or null without one', () => {
		expect(canonicalUrl('/atlas', { SITE_ORIGIN: 'https://serendipeak.example' })).toBe(
			'https://serendipeak.example/atlas'
		);
		expect(canonicalUrl('/atlas', {})).toBeNull();
	});
});
