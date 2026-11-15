import { describe, expect, it, vi } from 'vitest';
import { mountainShare } from './socialMetadata';
import { copyLink, readShareEnvironment, resolveShareUrl, shareLink } from './shareLink';

const target = { title: 'Aconcagua', url: 'https://serendipeak.example/mountains/aconcagua' };

function abort() {
	return new DOMException('Share canceled', 'AbortError');
}

describe('shareLink', () => {
	it('shares the permanent URL natively when the browser can', async () => {
		const share = vi.fn().mockResolvedValue(undefined);
		const writeText = vi.fn();

		expect(await shareLink(target, { share, writeText })).toBe('shared');
		expect(share).toHaveBeenCalledWith({ title: 'Aconcagua', url: target.url });
		expect(writeText).not.toHaveBeenCalled();
	});

	it('treats a dismissed native sheet as a cancellation, without copying', async () => {
		const writeText = vi.fn();

		expect(await shareLink(target, { share: () => Promise.reject(abort()), writeText })).toBe(
			'cancelled'
		);
		expect(writeText).not.toHaveBeenCalled();
	});

	it('falls back to the clipboard when native sharing fails for another reason', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		const share = () => Promise.reject(new DOMException('No activation', 'NotAllowedError'));

		expect(await shareLink(target, { share, writeText })).toBe('copied');
		expect(writeText).toHaveBeenCalledWith(target.url);
	});

	it('copies the URL when there is no native sharing', async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);

		expect(await shareLink(target, { writeText })).toBe('copied');
		expect(writeText).toHaveBeenCalledWith(target.url);
	});

	it('reports a denied clipboard as a failure', async () => {
		const writeText = () => Promise.reject(new DOMException('Denied', 'NotAllowedError'));

		expect(await shareLink(target, { writeText })).toBe('failed');
	});

	it('reports a missing clipboard as a failure', async () => {
		expect(await shareLink(target, {})).toBe('failed');
	});
});

describe('readShareEnvironment', () => {
	it('exposes only the abilities the browser has', () => {
		expect(readShareEnvironment({} as Navigator)).toEqual({
			share: undefined,
			writeText: undefined
		});
	});

	it('calls the browser methods on the navigator', async () => {
		const nav = {
			share: vi.fn(function (this: unknown) {
				return Promise.resolve(this);
			}),
			clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
		};
		const environment = readShareEnvironment(nav as unknown as Navigator);

		await environment.share?.(target);
		await environment.writeText?.('x');

		expect(nav.share.mock.contexts[0]).toBe(nav);
		expect(nav.clipboard.writeText).toHaveBeenCalledWith('x');
	});
});

describe('resolveShareUrl', () => {
	it('shares the canonical URL of a regular mountain page', () => {
		const share = mountainShare('aconcagua', 'https://serendipeak.example');

		expect(resolveShareUrl(share, 'http://elsewhere.test')).toBe(
			'https://serendipeak.example/mountains/aconcagua'
		);
	});

	it('shares the featured mountain, never the homepage, from the daily page', () => {
		const share = mountainShare('k2', 'https://serendipeak.example');

		expect(resolveShareUrl(share, 'https://serendipeak.example')).toBe(
			'https://serendipeak.example/mountains/k2'
		);
	});

	it('uses the visitor’s own origin with the permanent path when no origin is configured', () => {
		const share = mountainShare('cho oyu', null);

		expect(resolveShareUrl(share, 'http://localhost:3000')).toBe(
			'http://localhost:3000/mountains/cho%20oyu'
		);
	});
});

describe('copyLink', () => {
	it('copies without invoking native sharing, even when it is available', async () => {
		const share = vi.fn();
		const writeText = vi.fn().mockResolvedValue(undefined);

		expect(await copyLink(target.url, { share, writeText })).toBe('copied');
		expect(writeText).toHaveBeenCalledWith(target.url);
		expect(share).not.toHaveBeenCalled();
	});

	it('reports a denied or missing clipboard as a failure', async () => {
		expect(await copyLink(target.url, {})).toBe('failed');
		expect(await copyLink(target.url, { writeText: () => Promise.reject(new Error('no')) })).toBe(
			'failed'
		);
	});
});
