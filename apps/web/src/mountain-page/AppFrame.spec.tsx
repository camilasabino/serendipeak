import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DailyMountain, Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { AppFrame } from './AppFrame';
import { anchorsOf, countOf, textsOf } from './test-support/markup';
import type { PageModel } from './pageModel';

const mountain = contractFixture('mountain-complete.json') as Mountain;
const daily = contractFixture('daily-mountain.json') as DailyMountain;

function render(pageProps: object): string {
	return renderToStaticMarkup(
		<AppFrame pageProps={pageProps} year={2031}>
			<main>
				<h1>Page</h1>
			</main>
		</AppFrame>
	);
}

const permalink: PageModel = { kind: 'mountain', mountain };
const dailyModel: PageModel = { kind: 'daily', daily };

describe('AppFrame landmarks', () => {
	it.each([
		['a permalink', { model: permalink }],
		['the daily page', { model: dailyModel }],
		['an error page', { model: { kind: 'error', reason: 'not-found' } }],
		['a page without data', {}]
	])('wraps %s in one banner, one main and one contentinfo, in that order', (_name, props) => {
		const html = render(props);

		expect([countOf(html, 'header'), countOf(html, 'main'), countOf(html, 'footer')]).toEqual([
			1, 1, 1
		]);
		expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<main'));
		expect(html.indexOf('<main')).toBeLessThan(html.indexOf('<footer'));
	});
});

describe('AppFrame header', () => {
	it('links the brand home on every page', () => {
		for (const props of [{}, { model: permalink }]) {
			expect(anchorsOf(render(props))[0]).toMatchObject({ href: '/', text: 'SerendiPeak' });
		}
	});

	it("offers today's mountain and the Explore placeholder on a permalink", () => {
		const html = render({ model: permalink });

		expect(anchorsOf(html).map(({ text }) => text)).toContain("Today's mountain");
		expect(textsOf(html, 'button')).toEqual(['Explore another→']);
		expect(html).toMatch(/<button[^>]*disabled/);
	});

	it('offers only the Explore placeholder on the daily page', () => {
		const html = render({ model: dailyModel });

		expect(anchorsOf(html).map(({ text }) => text)).not.toContain("Today's mountain");
		expect(textsOf(html, 'button')).toEqual(['Explore another→']);
	});

	it.each([
		['an error page', { model: { kind: 'error', reason: 'unreachable' } }],
		['a page without data', {}]
	])('shows no navigation on %s', (_name, props) => {
		const html = render(props);

		expect(countOf(html, 'button')).toBe(0);
		expect(html).toContain('<header');
		expect(html.match(/<header[\s\S]*<\/header>/)?.[0]).not.toContain('Explore');
	});
});

describe('AppFrame footer', () => {
	const html = render({});

	it('shows the tagline, the given year and the external credits', () => {
		expect(textsOf(html, 'footer')[0]).toContain('One mountain. Somewhere on Earth. Every day.');
		expect(html).toContain('© 2031');
		const external = anchorsOf(html).filter(({ href }) => href.startsWith('https://'));
		expect(external.map(({ href }) => href)).toEqual([
			'https://camilasabino.dev',
			'https://github.com/camilasabino/serendipeak'
		]);
		for (const { attributes } of external) {
			expect(attributes).toContain('rel="external noopener noreferrer"');
		}
	});

	it('names the icon-only GitHub link', () => {
		expect(html).toContain('aria-label="GitHub"');
	});
});
