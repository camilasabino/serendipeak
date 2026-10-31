import { describe, expect, it } from 'vitest';
import { classifyFailure, type FailureReason } from './pageModel';

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
