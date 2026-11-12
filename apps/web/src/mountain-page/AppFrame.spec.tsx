import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DailyMountain, Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { TestExperience } from '../test/TestExperience';
import { AppFrame } from './AppFrame';
import { anchorsOf, countOf, textsOf } from './test-support/markup';
import { pageModelOf, type PageModel } from './pageModel';

const mountain = contractFixture('mountain-complete.json') as Mountain;
const daily = contractFixture('daily-mountain.json') as DailyMountain;

// A mountain page contributes content only; the layout supplies its landmark.
function render(pageProps: object, pathname?: string): string {
	const isMountainPage = pageModelOf(pageProps)?.kind !== 'error' && 'model' in pageProps;
	const content = <h1>Page</h1>;

	return renderToStaticMarkup(
		<TestExperience>
			<AppFrame pageProps={pageProps} year={2031} pathname={pathname}>
				{isMountainPage ? content : <main>{content}</main>}
			</AppFrame>
		</TestExperience>
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

describe('AppFrame stage', () => {
	it.each([
		['a permalink', { model: permalink }],
		['the daily page', { model: dailyModel }]
	])('puts the stage loader after the page content on %s', (_name, props) => {
		const html = render(props);

		expect(html.indexOf('<h1>Page</h1>')).toBeLessThan(html.indexOf('role="status"'));
		expect(html.indexOf('role="status"')).toBeLessThan(html.indexOf('</main>'));
	});

	it.each([
		['an error page', { model: { kind: 'error', reason: 'not-found' } }],
		['a page without data', {}]
	])('renders no stage on %s', (_name, props) => {
		expect(render(props)).not.toContain('role="status"');
	});
});

describe('AppFrame header', () => {
	it('links the brand home on every page', () => {
		for (const props of [{}, { model: permalink }]) {
			expect(anchorsOf(render(props))[0]).toMatchObject({ href: '/', text: 'SerendiPeak' });
		}
	});

	it("offers today's mountain and a usable Explore control on a permalink", () => {
		const html = render({ model: permalink });

		expect(anchorsOf(html).map(({ text }) => text)).toContain("Today's mountain");
		expect(textsOf(html, 'button')).toEqual(['Search mountains', 'Explore another→']);
		expect(html).not.toMatch(/<button[^>]*\sdisabled(=""|\s|>)/);
		expect(html).toContain('aria-busy="false"');
	});

	it('offers only the Explore control on the daily page', () => {
		const html = render({ model: dailyModel });

		expect(anchorsOf(html).map(({ text }) => text)).not.toContain("Today's mountain");
		expect(textsOf(html, 'button')).toEqual(['Search mountains', 'Explore another→']);
		expect(html).not.toMatch(/<button[^>]*\sdisabled(=""|\s|>)/);
	});

	it.each([
		['an error page', { model: { kind: 'error', reason: 'unreachable' } }],
		['a page without data', {}]
	])('shows no mountain navigation on %s', (_name, props) => {
		const html = render(props);

		expect(textsOf(html, 'button')).toEqual(['Search mountains']);
		expect(html).toContain('<header');
		expect(html.match(/<header[\s\S]*<\/header>/)?.[0]).not.toContain('Explore');
	});
});

describe('AppFrame About link', () => {
	it.each([
		['the daily page', { model: dailyModel }],
		['a permalink', { model: permalink }],
		['an error page', { model: { kind: 'error', reason: 'not-found' } }],
		['a page without data', {}]
	])('offers About in the primary navigation on %s', (_name, props) => {
		const html = render(props);
		const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '';

		expect(countOf(html, 'nav')).toBe(1);
		expect(nav).toContain('aria-label="Primary"');
		expect(anchorsOf(nav)[0]).toMatchObject({ href: '/about', text: 'About' });
		expect(html.indexOf('<header')).toBeLessThan(html.indexOf('<nav'));
		expect(html.indexOf('</nav>')).toBeLessThan(html.indexOf('</header>'));
	});

	it('keeps the mountain controls in the same navigation after About', () => {
		const nav = render({ model: permalink }).match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '';

		expect(anchorsOf(nav).map(({ text }) => text)).toEqual(['About', "Today's mountain"]);
		expect(textsOf(nav, 'button')).toEqual(['Search mountains', 'Explore another→']);
	});

	it.each([
		['the daily page', { model: dailyModel }],
		['a permalink', { model: permalink }],
		['an error page', { model: { kind: 'error', reason: 'not-found' } }],
		['a page without data', {}]
	])('offers search first in the primary navigation, closed, on %s', (_name, props) => {
		const html = render(props);
		const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '';

		expect(nav.indexOf('Search mountains')).toBeLessThan(nav.indexOf('href="/about"'));
		expect(nav).toContain('aria-haspopup="dialog"');
		expect(html).not.toContain('<dialog');
	});

	it('marks About as the current page only on the About route', () => {
		const onAbout = anchorsOf(render({}, '/about')).find(({ href }) => href === '/about');
		const elsewhere = anchorsOf(render({}, '/')).find(({ href }) => href === '/about');

		expect(onAbout?.attributes).toContain('aria-current="page"');
		expect(elsewhere?.attributes).not.toContain('aria-current');
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
