import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { mountainIndexEntry, serendipeakDocument } from './serendipeak-contract.mjs';

const contractsDirectory = new URL('../../../../contracts/v1/', import.meta.url);

// `catalog` serves the vendored catalog's 73 mountains as the index, for tests that need real
// density on the globe; every other route answers as in `ok`.
export const SCENARIOS = [
	'ok',
	'unreachable',
	'malformed',
	'server-error',
	'no-eligible',
	'catalog'
];

const INDEX_PATH = '/api/v1/mountains';
const API_PREFIX = `${INDEX_PATH}/`;
const CONTROL_PREFIX = '/__control/';

// The browser calls this API from the web origin, so every answer must be readable cross-origin.
const CORS = { 'Access-Control-Allow-Origin': '*' };

function fixture(name) {
	return serendipeakDocument(JSON.parse(readFileSync(new URL(name, contractsDirectory), 'utf8')));
}

// The catalog has no geography, so each entry gets a synthetic continent from rough boxes around
// its coordinates. None of it is editorial data; it only spreads the atlas list over continents.
const CONTINENT_BOXES = [
	['AN', ({ latitude }) => latitude < -60],
	['NA', ({ latitude, longitude }) => longitude < -25 && latitude > 8],
	['SA', ({ longitude }) => longitude < -25],
	['OC', ({ latitude, longitude }) => (longitude > 110 && latitude < 0) || longitude > 160],
	['AF', ({ latitude, longitude }) => longitude < 52 && latitude < 30],
	['EU', ({ latitude, longitude }) => longitude < 45 && latitude >= 36],
	['AS', () => true]
];
const CONTINENTS = {
	AF: 'Africa',
	AN: 'Antarctica',
	AS: 'Asia',
	EU: 'Europe',
	NA: 'North America',
	OC: 'Oceania',
	SA: 'South America'
};

function catalogIndex(served) {
	const catalog = JSON.parse(readFileSync(new URL('catalog.json', contractsDirectory), 'utf8'));
	const mountains = catalog.mountains.map((mountain) => {
		const known = served.get(mountain.slug);
		if (known) {
			return mountainIndexEntry(known);
		}
		const [code] = CONTINENT_BOXES.find(([, contains]) => contains(mountain.coordinates));
		return {
			slug: mountain.slug,
			name: mountain.name,
			coordinates: mountain.coordinates,
			elevationMeters: mountain.elevationMeters,
			continent: { code, name: CONTINENTS[code] },
			countries: [],
			region: null
		};
	});
	return { mountains };
}

function buildRoutes() {
	const mountainsBySlug = new Map(
		['mountain-complete.json', 'mountain-minimal.json', 'mountain-sparse.json']
			.map(fixture)
			.map((mountain) => [mountain.slug, mountain])
	);
	const index = {
		mountains: [...mountainsBySlug.values()]
			.sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
			.map(mountainIndexEntry)
	};
	return {
		index,
		catalogIndex: catalogIndex(mountainsBySlug),
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
	const { index, catalogIndex, daily, notFound, internal, noEligible, mountainsBySlug } =
		buildRoutes();
	let scenario = 'ok';
	let requests = [];

	function handleControl(request, response, pathname) {
		const send = (status, body) => {
			response.writeHead(status, { 'Content-Type': 'application/json', ...CORS });
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
			response.writeHead(status, { 'Content-Type': 'application/json', ...CORS, ...headers });
			response.end(typeof body === 'string' ? body : JSON.stringify(body));
		};

		const isIndex = pathname === INDEX_PATH;
		if (request.method !== 'GET' || !(isIndex || pathname.startsWith(API_PREFIX))) {
			send(404, notFound);
			return;
		}
		requests.push(`${pathname}${search}`);

		if (scenario === 'unreachable') {
			request.socket.destroy();
			return;
		}

		// No caching headers: every test sees the scenario it set, never an answer the browser kept.
		if (isIndex) {
			if (scenario === 'malformed') {
				send(200, '{"unexpected":true}');
			} else if (scenario === 'server-error') {
				send(500, internal, { 'Cache-Control': 'no-store' });
			} else {
				send(200, scenario === 'catalog' ? catalogIndex : index);
			}
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
			const excluded = new URLSearchParams(search).get('exclude');
			const eligible = [...mountainsBySlug.values()].filter(
				(mountain) => mountain.slug !== excluded
			);
			send(200, eligible[0] ?? daily.mountain, headers);
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
