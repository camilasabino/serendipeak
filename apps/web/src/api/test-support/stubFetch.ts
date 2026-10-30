import { vi } from 'vitest';

export const BASE_URL = 'http://api.test';

export function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { 'Content-Type': 'application/json; charset=utf-8' }
	});
}

export function stubFetch(respond: typeof globalThis.fetch) {
	return vi.fn<typeof globalThis.fetch>(respond);
}

export function serving(body: unknown, status = 200) {
	return stubFetch(async () => jsonResponse(body, status));
}

export function requestedUrl(fetch: ReturnType<typeof stubFetch>, call = 0): string {
	return String(fetch.mock.calls[call]?.[0]);
}

export function requestedInit(fetch: ReturnType<typeof stubFetch>, call = 0): RequestInit {
	return fetch.mock.calls[call]?.[1] ?? {};
}
