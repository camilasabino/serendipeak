import { describe, expect, it, vi } from 'vitest';
import { createNavigate, mountainHref } from './navigate';

function cancelled(): Error {
	return Object.assign(new Error('Route Cancelled'), { cancelled: true });
}

describe('mountainHref', () => {
	it('points at the permalink of the mountain', () => {
		expect(mountainHref('aconcagua')).toBe('/mountains/aconcagua');
	});

	it('encodes the slug as one path segment', () => {
		expect(mountainHref('a/b c?d')).toBe('/mountains/a%2Fb%20c%3Fd');
	});
});

describe('createNavigate', () => {
	it('pushes the permalink and reports that the route was reached', async () => {
		const push = vi.fn(async () => true);

		await expect(createNavigate(() => ({ push }))('fitz-roy')).resolves.toBe(true);

		expect(push).toHaveBeenCalledExactlyOnceWith('/mountains/fitz-roy');
	});

	it('reads the router at navigation time, not when it was created', async () => {
		let current = { push: vi.fn(async () => true) };
		const navigate = createNavigate(() => current);
		const next = { push: vi.fn(async () => true) };

		current = next;
		await navigate('fitz-roy');

		expect(next.push).toHaveBeenCalledTimes(1);
	});

	it('reports a navigation the router did not complete as not reached', async () => {
		const navigate = createNavigate(() => ({ push: async () => false }));

		await expect(navigate('fitz-roy')).resolves.toBe(false);
	});

	it('reports a navigation cancelled by a newer one as not reached, not as an error', async () => {
		const navigate = createNavigate(() => ({ push: () => Promise.reject(cancelled()) }));

		await expect(navigate('fitz-roy')).resolves.toBe(false);
	});

	it('lets any other router failure through', async () => {
		const boom = new Error('router bug');
		const navigate = createNavigate(() => ({ push: () => Promise.reject(boom) }));

		await expect(navigate('fitz-roy')).rejects.toBe(boom);
	});

	it('does not mistake a rejection that is not an error object for a cancellation', async () => {
		const navigate = createNavigate(() => ({ push: () => Promise.reject({ cancelled: true }) }));

		await expect(navigate('fitz-roy')).rejects.toEqual({ cancelled: true });
	});
});
