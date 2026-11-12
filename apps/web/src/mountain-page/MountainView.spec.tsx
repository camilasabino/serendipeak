import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { TestExperience } from '../test/TestExperience';
import { MountainView } from './MountainView';
import { anchorsOf, countOf, hasEmptyElement, textsOf } from './test-support/markup';

const complete = contractFixture('mountain-complete.json') as Mountain;
const sparse = contractFixture('mountain-sparse.json') as Mountain;
const minimal = contractFixture('mountain-minimal.json') as Mountain;

function render(mountain: Mountain, daily = false, preview = false): string {
	return renderToStaticMarkup(
		<TestExperience>
			<MountainView mountain={mountain} daily={daily} preview={preview} />
		</TestExperience>
	);
}

describe.each([
	['complete', complete],
	['sparse', sparse],
	['minimal', minimal]
])('%s fixture', (_name, mountain) => {
	it.each([false, true])('renders exactly one h1 with the name (daily: %s)', (daily) => {
		const html = render(mountain, daily);

		expect(textsOf(html, 'h1')).toEqual([mountain.name]);
		expect(countOf(html, 'h[2-6]')).toBe(0);
	});

	it.each([false, true])(
		'names its section by the heading and lets focus land there (daily: %s)',
		(daily) => {
			const html = render(mountain, daily);

			expect(html).toMatch(/<section aria-labelledby="mountain-name">/);
			expect(html).toMatch(/<h1 id="mountain-name" tabindex="-1"/);
		}
	);

	it.each([false, true])('leaves no empty element or placeholder text (daily: %s)', (daily) => {
		const html = render(mountain, daily);

		expect(hasEmptyElement(html)).toBe(false);
		expect(html).not.toMatch(/undefined|null|NaN|\bN\/A\b|[—–]|\bUnknown\b/);
	});

	it('opens every external link in a new tab without leaking the opener', () => {
		const external = anchorsOf(render(mountain)).filter(({ href }) => href.startsWith('http'));

		expect(external.length).toBeGreaterThan(0);
		for (const { attributes } of external) {
			expect(attributes).toContain('target="_blank"');
			expect(attributes).toContain('rel="external noopener noreferrer"');
		}
	});
});

describe('complete fixture', () => {
	const html = render(complete);

	it('renders summary, continent, country, region, elevation and coordinates in order', () => {
		expect(textsOf(html, 'dt')).toEqual([
			'Continent',
			'Country',
			'Region',
			'Elevation',
			'Coordinates'
		]);
		expect(textsOf(html, 'dd')).toEqual([
			'South America',
			'Argentina',
			'Principal Cordillera',
			'6,961 m',
			'32.6531° S, 70.0120° W'
		]);
		const order = [complete.summary, 'Elevation', '<figure', 'Data sources'].map((fragment) =>
			html.indexOf(fragment ?? '')
		);
		expect(order.every((position) => position > -1)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it('links coordinates to a map search', () => {
		const anchors = anchorsOf(html);

		expect(anchors.find(({ text }) => text.startsWith('32.6531'))?.href).toBe(
			'https://www.google.com/maps/search/?api=1&query=-32.6531487%2C-70.0119607'
		);
		expect(anchors.some(({ text }) => text.includes('Wikipedia'))).toBe(false);
	});

	it('renders both data sources inside the disclosure', () => {
		expect(html).toContain('Data sources');
		expect(anchorsOf(html).map(({ href }) => href)).toEqual(
			expect.arrayContaining([complete.sources?.osm, complete.sources?.wikidata])
		);
	});
});

describe('sparse fixture', () => {
	const html = render(sparse);

	it('keeps the region, the photograph and the data sources', () => {
		expect(textsOf(html, 'dt')).toEqual([
			'Continent',
			'Country',
			'Region',
			'Elevation',
			'Coordinates'
		]);
		expect(html).toContain('<figure');
		expect(html).toContain('Data sources');
	});
});

describe('minimal fixture', () => {
	const html = render(minimal);

	it('collapses to the name and the facts that exist', () => {
		expect(textsOf(html, 'dt')).toEqual(['Continent', 'Elevation', 'Coordinates']);
		expect(textsOf(html, 'dd')).toEqual(['Europe', '2,000 m', '45.0000° N, 10.0000° E']);
		expect(textsOf(html, 'p')).toEqual(['←Back to atlas']);
	});

	it.each(['Countr', 'Region', 'Data sources', '<figure', 'About this photo'])(
		'renders no %s',
		(fragment) => {
			expect(html).not.toContain(fragment);
		}
	);
});

describe('permalink composition', () => {
	const html = render(complete);

	it('leaves Today to the global navigation and shows no daily copy', () => {
		expect(anchorsOf(html).filter(({ href }) => href === '/')).toEqual([]);
		expect(html).not.toContain("Today's discovery");
		expect(html).not.toContain('Tomorrow, another mountain.');
	});
});

describe('daily composition', () => {
	const html = render(complete, true);

	it('shows the eyebrow before the name and the cue after the content', () => {
		expect(textsOf(html, 'p')).toEqual(expect.arrayContaining(["Today's discovery"]));
		expect(html.indexOf("Today's discovery")).toBeLessThan(html.indexOf('<h1'));
		expect(html.indexOf('Tomorrow, another mountain.')).toBeGreaterThan(
			html.indexOf('Data sources')
		);
	});

	it('does not link back to itself', () => {
		expect(anchorsOf(html).some(({ href }) => href === '/')).toBe(false);
	});

	it('renders the minimal fixture without the cue becoming a placeholder row', () => {
		const minimalDaily = render(minimal, true);

		expect(textsOf(minimalDaily, 'dt')).toEqual(['Continent', 'Elevation', 'Coordinates']);
		expect(minimalDaily).toContain('Tomorrow, another mountain.');
	});
});

describe('sheet', () => {
	it('renders the editorial sheet only, leaving the landmark and the stage to the layout', () => {
		const html = render(complete);

		expect(html).not.toMatch(/<main|<canvas|<script|<iframe|cesium|role="status"/i);
		expect(textsOf(html, 'button')).toEqual(['Explore another→', 'View photo fullscreen']);
	});
});

describe('preview', () => {
	it('tells the editor the page is an unpublished draft', () => {
		const html = render(complete, false, true);

		expect(html).toContain('role="note"');
		expect(html).toContain('This mountain is not published');
	});

	it('shows no notice on a public page', () => {
		expect(render(complete)).not.toContain('not published');
	});

	it('renders a draft without camera, photograph or sources like the minimal fixture', () => {
		const html = render(minimal, false, true);

		expect(textsOf(html, 'h1')).toEqual([minimal.name]);
		expect(html).toContain('This mountain is not published');
	});
});

describe('atlas link', () => {
	it('leads from a permalink back to the atlas, wherever the page was opened from', () => {
		expect(
			anchorsOf(render(complete)).find(({ text }) => text.includes('Back to atlas'))
		).toMatchObject({ href: '/atlas' });
	});

	it.each([
		['the daily page', true, false],
		['a draft preview', false, true]
	])('is absent from %s', (_name, daily, preview) => {
		expect(render(complete, daily, preview)).not.toContain('Back to atlas');
	});
});
