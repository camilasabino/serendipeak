import { expect, test } from '@playwright/test';
import { headingsOf, resetStub, stubRequests, titleOf } from './support';

const ABOUT_LINK = /<a[^>]*href="\/about"[^>]*>About<\/a>/;

function descriptionOf(html: string): string | null {
	const match = /<meta name="description" content="([^"]*)"/.exec(html);
	return match?.[1] ?? null;
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('about page', () => {
	test('is served with its title, description and a single h1', async ({ request }) => {
		const response = await request.get('/about');
		const html = await response.text();

		expect(response.status()).toBe(200);
		expect(titleOf(html)).toBe('About · SerendiPeak');
		expect(descriptionOf(html)).toMatch(/one mountain every day/);
		expect(descriptionOf(html)).toMatch(/atlas/);
		expect(headingsOf(html)).toEqual(['Discover one mountain every day.']);
		expect(html).toContain('<html lang="en"');
	});

	test('renders without calling the API or the 3D stage', async ({ request }) => {
		const html = await (await request.get('/about')).text();

		expect(await stubRequests(request)).toEqual([]);
		expect(html).not.toContain('data-stage');
		expect(html).not.toContain('role="status"');
	});

	test('is indexable and publicly cacheable like any static page', async ({ request }) => {
		const response = await request.get('/about');
		const html = await response.text();

		expect(html).not.toMatch(/name="robots"/);
		expect(response.headers()['cache-control'] ?? '').not.toMatch(/no-store|private/);
	});

	test('marks About as the current page in the primary navigation', async ({ request }) => {
		const html = await (await request.get('/about')).text();

		expect(html).toMatch(/<nav[^>]*aria-label="Primary"/);
		expect(html).toMatch(
			/<a[^>]*aria-current="page"[^>]*href="\/about"|<a[^>]*href="\/about"[^>]*aria-current="page"/
		);
	});
});

test.describe('about link in the site header', () => {
	for (const path of ['/', '/mountains/aconcagua', '/atlas']) {
		test(`is offered on ${path}`, async ({ request }) => {
			const html = await (await request.get(path)).text();

			expect(html).toMatch(ABOUT_LINK);
			expect(html).not.toMatch(/href="\/about"[^>]*aria-current/);
		});
	}
});

test.describe('primary navigation in the site header', () => {
	const destinations = [
		['Today', '/'],
		['Atlas', '/atlas'],
		['About', '/about']
	] as const;

	for (const path of ['/', '/mountains/aconcagua', '/atlas', '/about', '/mountains/missing']) {
		test(`offers Today, Atlas, About and search on ${path}`, async ({ request }) => {
			const html = await (await request.get(path)).text();
			const nav = /<nav[^>]*aria-label="Primary"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';

			expect(nav).toMatch(/<button[^>]*aria-haspopup="dialog"[\s\S]*> mountains<\/span>/);
			for (const [label, href] of destinations) {
				expect(nav).toMatch(new RegExp(`<a[^>]*href="${href}"[^>]*>${label}</a>`));
			}
		});
	}

	const current: Array<[string, string | null]> = [
		['/', 'Today'],
		['/atlas', 'Atlas'],
		['/about', 'About'],
		['/mountains/aconcagua', null]
	];

	for (const [path, label] of current) {
		test(`marks ${label ?? 'nothing'} as current on ${path}`, async ({ request }) => {
			const html = await (await request.get(path)).text();
			const nav = /<nav[^>]*aria-label="Primary"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? '';
			const marked = [...nav.matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)].map(
				(match) => match[1]
			);

			expect(marked).toEqual(label ? [label] : []);
		});
	}
});
