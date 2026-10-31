import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const contractsDirectory = new URL('../../../../contracts/v1/', import.meta.url);

export const SCENARIOS = ['ok', 'unreachable', 'malformed', 'server-error', 'no-eligible'];

const API_PREFIX = '/api/v1/mountains/';
const CONTROL_PREFIX = '/__control/';

function fixture(name) {
	return JSON.parse(readFileSync(new URL(name, contractsDirectory), 'utf8'));
}

function buildRoutes() {
	const mountainsBySlug = new Map(
		['mountain-complete.json', 'mountain-minimal.json', 'mountain-sparse.json']
			.map(fixture)
			.map((mountain) => [mountain.slug, mountain])
	);
	return {
		daily: fixture('daily-mountain.json'),
		notFound: fixture('error-mountain-not-found.json'),
		internal: fixture('error-internal.json'),
		noEligible: fixture('error-no-eligible-mountains.json'),
		mountainsBySlug
	};
}

function decodeSlug(encoded) {
	try {
		return decodeURIComponent(encoded);
	} catch {
		return null;
	}
}

export function createStubApi() {
	const { daily, notFound, internal, noEligible, mountainsBySlug } = buildRoutes();
	let scenario = 'ok';
	let requests = [];

	function handleControl(request, response, pathname) {
		const send = (status, body) => {
			response.writeHead(status, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify(body));
		};
		const action = pathname.slice(CONTROL_PREFIX.length);

		if (request.method === 'GET' && action === 'requests') {
			send(200, requests);
		} else if (request.method === 'POST' && action === 'reset') {
			scenario = 'ok';
			requests = [];
			send(200, { scenario });
		} else if (request.method === 'POST' && action.startsWith('scenario/')) {
			const requested = action.slice('scenario/'.length);
			if (!SCENARIOS.includes(requested)) {
				send(400, { error: `unknown scenario: ${requested}` });
				return;
			}
			scenario = requested;
			send(200, { scenario });
		} else {
			send(404, notFound);
		}
	}

	return createServer((request, response) => {
		const { pathname, search } = new URL(request.url ?? '/', 'http://stub.invalid');

		if (pathname.startsWith(CONTROL_PREFIX)) {
			handleControl(request, response, pathname);
			return;
		}

		const send = (status, body, headers = {}) => {
			response.writeHead(status, { 'Content-Type': 'application/json', ...headers });
			response.end(typeof body === 'string' ? body : JSON.stringify(body));
		};

		if (request.method !== 'GET' || !pathname.startsWith(API_PREFIX)) {
			send(404, notFound);
			return;
		}
		requests.push(`${pathname}${search}`);

		if (scenario === 'unreachable') {
			request.socket.destroy();
			return;
		}

		const slug = decodeSlug(pathname.slice(API_PREFIX.length));
		const stateful = slug === 'today' || slug === 'random';
		const headers = stateful ? { 'Cache-Control': 'no-store' } : {};

		if (scenario === 'malformed') {
			send(200, '{"unexpected":true}', headers);
		} else if (scenario === 'server-error') {
			send(500, internal, headers);
		} else if (scenario === 'no-eligible' && stateful) {
			send(503, noEligible, headers);
		} else if (slug === 'today') {
			send(200, daily, headers);
		} else if (slug === 'random') {
			send(200, daily.mountain, headers);
		} else {
			const mountain = slug === null ? undefined : mountainsBySlug.get(slug);
			send(mountain ? 200 : 404, mountain ?? notFound);
		}
	});
}

if (isMain()) {
	const port = Number(process.env.STUB_API_PORT ?? 8099);
	createStubApi().listen(port, '127.0.0.1', () => {
		console.log(`stub API listening on http://127.0.0.1:${port}`);
	});
}

function isMain() {
	return process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
}
