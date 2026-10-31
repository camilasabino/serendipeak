import { describe, expect, it, vi } from 'vitest';
import { bindRouteChanges, createNavigate, mountainHref, type RouteEvents } from './navigate';

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

describe('bindRouteChanges', () => {
	function fakeEvents() {
		const handlers = new Map<string, Set<(url: string) => void>>();
		const events: RouteEvents = {
			on: (event, handler) => {
				handlers.set(event, (handlers.get(event) ?? new Set()).add(handler));
			},
			off: (event, handler) => {
				handlers.get(event)?.delete(handler);
			}
		};
		const emit = (event: string, url: string) => handlers.get(event)?.forEach((h) => h(url));

		return { events, emit, listening: (event: string) => handlers.get(event)?.size ?? 0 };
	}

	it('reports the url of every route change as it starts', () => {
		const { events, emit } = fakeEvents();
		const started = vi.fn();
		bindRouteChanges(events, started);

		emit('routeChangeStart', '/mountains/aconcagua');
		emit('routeChangeStart', '/');

		expect(started.mock.calls).toEqual([['/mountains/aconcagua'], ['/']]);
	});

	it('listens to route starts only', () => {
		const { events, emit } = fakeEvents();
		const started = vi.fn();
		bindRouteChanges(events, started);

		emit('routeChangeComplete', '/mountains/aconcagua');
		emit('routeChangeError', '/mountains/aconcagua');

		expect(started).not.toHaveBeenCalled();
	});

	it('stops reporting once released', () => {
		const { events, emit, listening } = fakeEvents();
		const started = vi.fn();
		const release = bindRouteChanges(events, started);

		release();
		emit('routeChangeStart', '/');

		expect(started).not.toHaveBeenCalled();
		expect(listening('routeChangeStart')).toBe(0);
	});
});
