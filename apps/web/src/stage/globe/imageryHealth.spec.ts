import { describe, expect, it } from 'vitest';
import { ImageryHealth, providerErrorStatus } from './imageryHealth';

const WINDOW = 8000;

describe('providerErrorStatus', () => {
	it('reads the status code of the nested request error', () => {
		expect(providerErrorStatus({ error: { statusCode: 429 } })).toBe(429);
	});

	it('reads a status code carried by the error itself', () => {
		expect(providerErrorStatus({ statusCode: 403 })).toBe(403);
	});

	it('returns undefined for shapes without a usable HTTP status', () => {
		for (const error of [
			undefined,
			null,
			'boom',
			42,
			new Error('network'),
			{ error: 'text' },
			{ error: { statusCode: 'abc' } },
			{ error: { statusCode: 99 } },
			{ error: { statusCode: 700 } },
			{ error: { statusCode: 404.5 } }
		]) {
			expect(providerErrorStatus(error)).toBeUndefined();
		}
	});
});

describe('imagery health policy', () => {
	it('starts healthy', () => {
		expect(new ImageryHealth().degraded).toBe(false);
	});

	it('degrades immediately when the layer fails to be created', () => {
		const health = new ImageryHealth();

		expect(health.layerFailed()).toBe(true);
		expect(health.degraded).toBe(true);
	});

	it('clears a pre-ready layer failure once the provider becomes ready', () => {
		const health = new ImageryHealth();
		health.layerFailed();

		expect(health.providerReady()).toBe(true);
		expect(health.degraded).toBe(false);
	});

	it('reports nothing when the provider becomes ready on a healthy layer', () => {
		const health = new ImageryHealth();

		expect(health.providerReady()).toBe(false);
		expect(health.degraded).toBe(false);
	});

	it('keeps a layer failure that arrives after the provider was ready', () => {
		const health = new ImageryHealth();
		health.providerReady();

		expect(health.layerFailed()).toBe(true);
		expect(health.providerReady()).toBe(false);
		expect(health.degraded).toBe(true);
	});

	it('does not tolerate a late ready signal after a runtime degradation', () => {
		const health = new ImageryHealth();
		health.layerFailed();
		health.providerError({ error: { statusCode: 403 } }, 0);

		expect(health.providerReady()).toBe(false);
		expect(health.degraded).toBe(true);
	});

	it('stays healthy after one or two generic errors inside the window', () => {
		const health = new ImageryHealth();

		expect(health.providerError(new Error('tile'), 0)).toBe(false);
		expect(health.providerError(new Error('tile'), 1000)).toBe(false);
		expect(health.degraded).toBe(false);
	});

	it('degrades at the third generic error inside the window', () => {
		const health = new ImageryHealth();
		health.providerError(new Error('tile'), 0);
		health.providerError(new Error('tile'), 1000);

		expect(health.providerError(new Error('tile'), 2000)).toBe(true);
		expect(health.degraded).toBe(true);
	});

	it('counts errors exactly at the window edge', () => {
		const health = new ImageryHealth();
		health.providerError(undefined, 0);
		health.providerError(undefined, 4000);

		expect(health.providerError(undefined, WINDOW)).toBe(true);
	});

	it('does not accumulate errors spread outside the rolling window', () => {
		const health = new ImageryHealth();
		health.providerError(undefined, 0);
		health.providerError(undefined, 5000);

		expect(health.providerError(undefined, 10000)).toBe(false);
		expect(health.providerError(undefined, 15000)).toBe(false);
		expect(health.providerError(undefined, 22000)).toBe(false);
		expect(health.degraded).toBe(false);
	});

	it('does not carry an old error into a later burst', () => {
		const health = new ImageryHealth();
		health.providerError(undefined, 0);
		health.providerError(undefined, 20000);

		expect(health.providerError(undefined, 21000)).toBe(false);
		expect(health.providerError(undefined, 22000)).toBe(true);
	});

	it.each([401, 403, 429])('degrades immediately on HTTP %i', (statusCode) => {
		const health = new ImageryHealth();

		expect(health.providerError({ error: { statusCode } }, 0)).toBe(true);
		expect(health.degraded).toBe(true);
	});

	it.each([404, 500, 503])('does not degrade immediately on one HTTP %i', (statusCode) => {
		const health = new ImageryHealth();

		expect(health.providerError({ error: { statusCode } }, 0)).toBe(false);
		expect(health.degraded).toBe(false);
	});

	it('counts non-hard statuses toward the generic threshold', () => {
		const health = new ImageryHealth();
		health.providerError({ error: { statusCode: 404 } }, 0);
		health.providerError({ error: { statusCode: 500 } }, 100);

		expect(health.providerError({ error: { statusCode: 404 } }, 200)).toBe(true);
	});

	it('treats an unknown error shape as a generic error', () => {
		const health = new ImageryHealth();

		expect(health.providerError({ weird: Symbol('x') }, 0)).toBe(false);
		expect(health.providerError(null, 1)).toBe(false);
		expect(health.providerError('text', 2)).toBe(true);
	});

	it('reports the degradation transition only once', () => {
		const health = new ImageryHealth();

		expect(health.providerError({ error: { statusCode: 401 } }, 0)).toBe(true);
		expect(health.providerError({ error: { statusCode: 401 } }, 1)).toBe(false);
		expect(health.providerError(undefined, 2)).toBe(false);
		expect(health.layerFailed()).toBe(false);
		expect(health.degraded).toBe(true);
	});
});
