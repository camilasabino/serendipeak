import { describe, expect, it } from 'vitest';
import {
	classifyFailure,
	nearbyOf,
	pageModelOf,
	type FailureReason,
	type PageModel
} from './pageModel';

describe('classifyFailure', () => {
	it.each<[FailureReason, number]>([
		['not-found', 404],
		['unreachable', 503],
		['no-eligible-mountains', 503],
		['api-error', 502]
	])('maps %s to %i', (reason, status) => {
		expect(classifyFailure(reason)).toBe(status);
	});
});

describe('pageModelOf', () => {
	it.each<PageModel>([
		{ kind: 'error', reason: 'not-found' },
		{ kind: 'error', reason: 'unreachable' }
	])('returns the model carried by the page props', (model) => {
		expect(pageModelOf({ model })).toBe(model);
	});

	it.each([{}, { model: null }, { model: 'mountain' }, { model: {} }, { other: 1 }])(
		'returns nothing for page props without a model: %j',
		(pageProps) => {
			expect(pageModelOf(pageProps)).toBeUndefined();
		}
	);
});

describe('nearbyOf', () => {
	it('returns the nearby mountains the page props carry', () => {
		const nearby = [{ slug: 'cerro-el-plata' }];

		expect(nearbyOf({ model: {}, nearby })).toBe(nearby);
	});

	it.each([{}, { nearby: null }, { nearby: 'cerro-el-plata' }])(
		'returns none for page props without a list: %j',
		(pageProps) => {
			expect(nearbyOf(pageProps)).toEqual([]);
		}
	);
});
