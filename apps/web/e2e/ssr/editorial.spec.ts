import { expect, test } from '@playwright/test';
import {
	anchorsOf,
	countOf,
	hasEmptyElement,
	textsOf
} from '../../src/mountain-page/test-support/markup';
import { fixture, headingsOf, resetStub } from './support';

interface Mountain {
	slug: string;
	name: string;
	sources?: object;
	primaryImage?: {
		author: string;
		sourcePageUrl?: string;
		license?: string;
		licenseUrl?: string;
	};
}

const complete = fixture<Mountain>('mountain-complete.json');
const sparse = fixture<Mountain>('mountain-sparse.json');
const minimal = fixture<Mountain>('mountain-minimal.json');
const daily = fixture<{ mountain: Mountain }>('daily-mountain.json');

const STAGE_LOADER = 'role="status"';

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

for (const mountain of [complete, sparse, minimal]) {
	test.describe(`permalink /mountains/${mountain.slug}`, () => {
		let html: string;

		test.beforeEach(async ({ request }) => {
			html = await (await request.get(`/mountains/${mountain.slug}`)).text();
		});

		test('has one h1 and the three landmarks in order', () => {
			expect(headingsOf(html)).toEqual([mountain.name]);
			expect([countOf(html, 'header'), countOf(html, 'main'), countOf(html, 'footer')]).toEqual([
				1, 1, 1
			]);
			expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'));
			expect(html.indexOf('</main>')).toBeLessThan(html.indexOf('<footer'));
		});

		test('reads the editorial content before the stage', () => {
			const stage = html.indexOf(STAGE_LOADER);

			expect(stage).toBeGreaterThan(html.indexOf('<h1'));
			expect(stage).toBeGreaterThan(html.indexOf('Elevation'));
			expect(stage).toBeLessThan(html.indexOf('</main>'));
		});

		test('leaves no empty element or placeholder for absent fields', () => {
			const body = html.slice(html.indexOf('<body'), html.indexOf('<script'));

			expect(hasEmptyElement(body)).toBe(false);
			expect(body).not.toMatch(/undefined|null|NaN|\bN\/A\b/);
		});

		test('renders links only for the fields the mountain has', () => {
			const labels = anchorsOf(html).map(({ text }) => text);

			expect(labels.some((text) => text.includes('Wikipedia'))).toBe(false);
			expect(html.includes('Data sources')).toBe(mountain.sources !== undefined);
			expect(html.includes('<figure')).toBe(mountain.primaryImage !== undefined);
			expect(labels.filter((text) => text === "Today's mountain")).toHaveLength(2);
		});
	});
}

test.describe('photograph credit', () => {
	for (const mountain of [complete, sparse]) {
		test(`credits the author of ${mountain.slug} with the license after it`, async ({
			request
		}) => {
			const image = mountain.primaryImage!;
			const html = await (await request.get(`/mountains/${mountain.slug}`)).text();
			const anchors = anchorsOf(html);

			expect(textsOf(html, 'p')).toContain(`Photo by ${image.author}·${image.license}`);
			expect(anchors.find(({ text }) => text === image.author)?.href).toBe(image.sourcePageUrl);
			expect(anchors.find(({ text }) => text === image.license)?.href).toBe(image.licenseUrl);
			expect(html).not.toMatch(/Source:|View original|Wikimedia Commons/);
		});
	}
});

test.describe('minimal permalink', () => {
	test('collapses to elevation and coordinates', async ({ request }) => {
		const html = await (await request.get(`/mountains/${minimal.slug}`)).text();

		expect(textsOf(html, 'dt')).toEqual(['Elevation', 'Coordinates']);
	});
});

test.describe('daily page', () => {
	test('composes the eyebrow, the cue and no link to itself', async ({ request }) => {
		const html = await (await request.get('/?utm=x')).text();
		const labels = anchorsOf(html).map(({ text }) => text);

		expect(headingsOf(html)).toEqual([daily.mountain.name]);
		expect(html.indexOf('Today&#x27;s discovery')).toBeGreaterThan(-1);
		expect(html.indexOf('Today&#x27;s discovery')).toBeLessThan(html.indexOf('<h1'));
		expect(html.indexOf('Tomorrow, another mountain.')).toBeLessThan(html.indexOf(STAGE_LOADER));
		expect(labels).not.toContain("Today's mountain");
		expect(textsOf(html, 'button')).toEqual(['Explore another→', 'View photo fullscreen']);
		expect(html).toMatch(/<button[^>]*disabled=""[^>]*>\s*<span[^>]*>View photo fullscreen/);
	});

	test('announces the daily reveal in the stage loader', async ({ request }) => {
		const html = await (await request.get('/')).text();

		expect(html).toContain('Revealing today&#x27;s mountain...');
	});
});
