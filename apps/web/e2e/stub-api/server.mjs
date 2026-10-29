import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const contractsDirectory = new URL('../../../../contracts/v1/', import.meta.url);

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
		mountainsBySlug
	};
}

export function createStubApi() {
	const { daily, notFound, mountainsBySlug } = buildRoutes();
	const prefix = '/api/v1/mountains/';

	return createServer((request, response) => {
		const { pathname } = new URL(request.url ?? '/', 'http://stub.invalid');
		const send = (status, body) => {
			response.writeHead(status, { 'Content-Type': 'application/json' });
			response.end(JSON.stringify(body));
		};

		if (request.method !== 'GET' || !pathname.startsWith(prefix)) {
			send(404, notFound);
			return;
		}
		const slug = decodeURIComponent(pathname.slice(prefix.length));
		if (slug === 'today') {
			send(200, daily);
			return;
		}
		const mountain = mountainsBySlug.get(slug);
		send(mountain ? 200 : 404, mountain ?? notFound);
	});
}

if (import.meta.url === `file://${process.argv[1]}`) {
	const port = Number(process.env.STUB_API_PORT ?? 8099);
	createStubApi().listen(port, '127.0.0.1', () => {
		console.log(`stub API listening on http://127.0.0.1:${port}`);
	});
}
