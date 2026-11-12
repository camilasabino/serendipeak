import type {
	ApiError,
	DailyMountainResult,
	MountainIndexResult,
	MountainResult,
	RandomMountainResult,
	Unreachable
} from './contract';
import type { PreviewGrant } from '../editorial/preview/previewGrant';
import type { MountainApi, MountainPreviewApi } from './MountainApi';
import { hasErrorCode, isDailyMountain, isMountain, isMountainIndex } from './schema';

export const DEFAULT_TIMEOUT_MS = 5_000;

const MOUNTAIN_NOT_FOUND = 'MOUNTAIN_NOT_FOUND';
const NO_ELIGIBLE_MOUNTAINS = 'NO_ELIGIBLE_MOUNTAINS';

export interface HttpMountainApiOptions {
	baseUrl: string;
	fetch?: typeof globalThis.fetch;
	timeoutMs?: number;
}

type Exchange = Unreachable | { kind: 'response'; status: number; ok: boolean; body: unknown };

export class HttpMountainApi implements MountainApi, MountainPreviewApi {
	private readonly baseUrl: string;
	private readonly fetchFn: typeof globalThis.fetch;
	private readonly timeoutMs: number;

	constructor({ baseUrl, fetch, timeoutMs = DEFAULT_TIMEOUT_MS }: HttpMountainApiOptions) {
		if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
			throw new RangeError(`timeoutMs must be a positive number, received ${timeoutMs}.`);
		}
		this.baseUrl = baseUrl.replace(/\/+$/, '');
		// Calling a stored native fetch as a method of this object throws "Illegal invocation" in browsers.
		this.fetchFn = fetch ?? ((input, init) => globalThis.fetch(input, init));
		this.timeoutMs = timeoutMs;
	}

	async getMountain(slug: string): Promise<MountainResult> {
		const exchange = await this.get(`/api/v1/mountains/${encodeURIComponent(slug)}`, {
			noStore: false
		});
		if (exchange.kind === 'unreachable') {
			return exchange;
		}

		if (exchange.status === 404 && hasErrorCode(exchange.body, MOUNTAIN_NOT_FOUND)) {
			return { kind: 'not-found' };
		}
		if (exchange.ok && isMountain(exchange.body)) {
			return { kind: 'found', mountain: exchange.body };
		}

		return apiError(exchange.status);
	}

	// The API lets the browser cache the index briefly, so this request honours HTTP caching.
	async getMountainIndex(): Promise<MountainIndexResult> {
		const exchange = await this.get('/api/v1/mountains', { noStore: false });
		if (exchange.kind === 'unreachable') {
			return exchange;
		}

		if (exchange.ok && isMountainIndex(exchange.body)) {
			return { kind: 'found', mountains: exchange.body.mountains };
		}

		return apiError(exchange.status);
	}

	async getMountainPreview(token: string): Promise<MountainResult> {
		const exchange = await this.get('/api/v1/previews/mountain', { noStore: true, bearer: token });
		if (exchange.kind === 'unreachable') {
			return exchange;
		}

		if (exchange.status === 404 && hasErrorCode(exchange.body, MOUNTAIN_NOT_FOUND)) {
			return { kind: 'not-found' };
		}
		if (exchange.ok && isMountain(exchange.body)) {
			return { kind: 'found', mountain: exchange.body };
		}

		return apiError(exchange.status);
	}

	async getDailyMountain(): Promise<DailyMountainResult> {
		const exchange = await this.get('/api/v1/mountains/today', { noStore: true });
		if (exchange.kind === 'unreachable') {
			return exchange;
		}

		if (isNoEligibleMountains(exchange)) {
			return { kind: 'no-eligible-mountains' };
		}
		if (exchange.ok && isDailyMountain(exchange.body)) {
			return { kind: 'found', daily: exchange.body };
		}

		return apiError(exchange.status);
	}

	async getRandomMountain(exclude?: string): Promise<RandomMountainResult> {
		const query = exclude === undefined ? '' : `?exclude=${encodeURIComponent(exclude)}`;
		const exchange = await this.get(`/api/v1/mountains/random${query}`, { noStore: true });
		if (exchange.kind === 'unreachable') {
			return exchange;
		}

		if (isNoEligibleMountains(exchange)) {
			return { kind: 'no-eligible-mountains' };
		}
		if (exchange.ok && isMountain(exchange.body)) {
			return { kind: 'found', mountain: exchange.body };
		}

		return apiError(exchange.status);
	}

	private async get(
		path: string,
		{ noStore, bearer }: { noStore: boolean; bearer?: string }
	): Promise<Exchange> {
		// The signal stays armed while the body streams, so a stalled body also times out.
		const init: RequestInit = { signal: AbortSignal.timeout(this.timeoutMs) };
		if (noStore) {
			init.cache = 'no-store';
		}
		if (bearer !== undefined) {
			init.headers = { Authorization: `Bearer ${bearer}` };
		}

		let response: Response;
		let text: string;
		try {
			response = await this.fetchFn(`${this.baseUrl}${path}`, init);
			text = await response.text();
		} catch {
			return { kind: 'unreachable' };
		}

		return { kind: 'response', status: response.status, ok: response.ok, body: parseJson(text) };
	}
}

function apiError(status: number): ApiError {
	return { kind: 'api-error', status };
}

function isNoEligibleMountains(exchange: { status: number; body: unknown }): boolean {
	return exchange.status === 503 && hasErrorCode(exchange.body, NO_ELIGIBLE_MOUNTAINS);
}

function parseJson(text: string): unknown {
	try {
		return JSON.parse(text);
	} catch {
		return undefined;
	}
}

export type PreviewExchange = 'started' | 'rejected' | 'failed';

// Trades the grant for the web origin's own Preview Mode cookie. It goes to this site's server, not
// to the mountain API, and the token travels in the body so it never appears in a URL.
export async function startPreviewSession(
	grant: PreviewGrant,
	fetchFn: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init)
): Promise<PreviewExchange> {
	let response: Response;
	try {
		response = await fetchFn('/api/preview', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(grant),
			cache: 'no-store',
			credentials: 'same-origin',
			referrerPolicy: 'no-referrer'
		});
	} catch {
		return 'failed';
	}

	if (response.ok) {
		return 'started';
	}

	return response.status === 400 ? 'rejected' : 'failed';
}
