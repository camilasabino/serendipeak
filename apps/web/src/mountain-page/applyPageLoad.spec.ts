import { describe, expect, it, vi } from 'vitest';
import { applyPageLoad } from './applyPageLoad';
import { failedLoad, NO_STORE } from './pageModel';

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
});
