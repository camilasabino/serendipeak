import { describe, expect, it, vi } from 'vitest';
import { applyPageLoad } from './applyPageLoad';
import { contractFixture } from '../api/test-support/contractFixtures';
import type { Mountain } from '../api/contract';
import { failedLoad, NO_STORE, previewLoad } from './pageModel';

function fakeResponse() {
	return { statusCode: 200, setHeader: vi.fn() };
}

describe('applyPageLoad', () => {
	it('sets the status and the cache header and returns the model as props', () => {
		const response = fakeResponse();
		const load = failedLoad('unreachable', NO_STORE);

		const result = applyPageLoad(response, load);

		expect(response.statusCode).toBe(503);
		expect(response.setHeader).toHaveBeenCalledExactlyOnceWith('Cache-Control', 'no-store');
		expect(result).toEqual({ props: { model: load.model } });
	});

	it('leaves the cache header alone when the load carries none', () => {
		const response = fakeResponse();

		applyPageLoad(response, failedLoad('not-found'));

		expect(response.statusCode).toBe(404);
		expect(response.setHeader).not.toHaveBeenCalled();
	});

	it('marks a preview private, uncached and unindexed', () => {
		const response = fakeResponse();

		applyPageLoad(response, previewLoad(contractFixture('mountain-complete.json') as Mountain));

		expect(response.statusCode).toBe(200);
		expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
		expect(response.setHeader).toHaveBeenCalledWith('X-Robots-Tag', 'noindex');
	});
});
