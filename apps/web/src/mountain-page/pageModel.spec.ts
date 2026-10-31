import { describe, expect, it } from 'vitest';
import { classifyFailure, pageModelOf, type FailureReason, type PageModel } from './pageModel';

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
