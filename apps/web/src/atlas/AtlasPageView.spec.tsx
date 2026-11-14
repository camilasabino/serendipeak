import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MountainIndexEntry } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import { AppFrame } from '../mountain-page/AppFrame';
import { anchorsOf, countOf, textsOf } from '../mountain-page/test-support/markup';
import { TestExperience } from '../test/TestExperience';
import { TestRouter } from '../test/TestRouter';
import { AtlasList } from './AtlasList';
import { AtlasPageView, type AtlasPageProps } from './AtlasPageView';
import { groupByContinent } from './groupByContinent';
import { OpenContinentsProvider } from './OpenContinentsContext';

const MOUNTAINS: MountainIndexEntry[] = [
	indexEntry('mont-blanc', 'Mont Blanc', {
		countries: [
			{ code: 'FR', name: 'France' },
			{ code: 'IT', name: 'Italy' }
		],
		elevationMeters: 4806
	}),
	indexEntry('mount-everest', 'Mount Everest', {
		continent: { code: 'AS', name: 'Asia' },
		countries: [{ code: 'NP', name: 'Nepal' }],
		elevationMeters: 8849
	}),
	indexEntry('eiger', 'Eiger', { elevationMeters: 3967 })
];

function render(props: AtlasPageProps): string {
	return renderToStaticMarkup(
		<TestRouter pathname="/atlas">
			<TestExperience>
				<AppFrame pageProps={props} year={2031} pathname="/atlas">
					<AtlasPageView {...props} />
				</AppFrame>
			</TestExperience>
		</TestRouter>
	);
}

const ATLAS: AtlasPageProps = {
	model: { kind: 'atlas', mountains: MOUNTAINS },
	canonicalUrl: 'https://serendipeak.example/atlas'
};

const mountainLinks = (html: string) =>
	anchorsOf(html).filter(({ href }) => href.startsWith('/mountains/'));

describe('atlas page', () => {
	const html = render(ATLAS);

	it('renders the panel and the stage in one main landmark, the panel first', () => {
		expect(countOf(html, 'main')).toBe(1);
		expect(textsOf(html, 'h1')).toEqual(['Atlas']);
		expect(html.indexOf('<h1')).toBeLessThan(html.indexOf('Preparing the atlas...'));
	});

	it('groups the mountains by continent, every continent collapsed, with its count', () => {
		const groups = html.match(/<details[^>]*>/g) ?? [];

		expect(groups).toHaveLength(2);
		expect(groups.every((tag) => !/\sopen/.test(tag))).toBe(true);
		expect(textsOf(html, 'summary')).toEqual(['Asia1 mountain', 'Europe2 mountains']);
		expect(html).toContain('All 3 mountains on the globe');
	});

	it('keeps every mountain in the document as a link to its own page, in order', () => {
		expect(mountainLinks(html).map(({ href }) => href)).toEqual([
			'/mountains/mount-everest',
			'/mountains/eiger',
			'/mountains/mont-blanc'
		]);
		expect(html).toContain('France and Italy · 4,806 m');
	});

	it('shows no selection card, no Fly to and no selection state', () => {
		expect(html).not.toMatch(/On the atlas|Fly to|aria-current="true"|aria-live/);
	});

	it('tells how to open a mountain from the globe and from the list, and renders no chooser', () => {
		expect(html).toContain('Click or tap a point to open its page');
		expect(html).toContain('or browse by continent below');
		expect(html).not.toContain('Which mountain?');
	});

	it('marks Atlas as the current page and offers no mountain controls in the header', () => {
		const nav = html.match(/<nav[\s\S]*?<\/nav>/)?.[0] ?? '';

		expect(anchorsOf(nav).find(({ href }) => href === '/atlas')?.attributes).toContain(
			'aria-current="page"'
		);
		expect(nav).not.toContain('Explore another');
	});
});

describe('atlas list memory', () => {
	it('opens the continents the reader left open', () => {
		const html = renderToStaticMarkup(
			<OpenContinentsProvider value={new Set(['EU'])}>
				<AtlasList groups={groupByContinent(MOUNTAINS)} />
			</OpenContinentsProvider>
		);
		const groups = html.match(/<details[^>]*>/g) ?? [];

		expect(groups.map((tag) => /\sopen/.test(tag))).toEqual([false, true]);
	});
});

describe('atlas page edge states', () => {
	it('says the atlas is empty and renders no list for an empty catalog', () => {
		const html = render({ model: { kind: 'atlas', mountains: [] }, canonicalUrl: null });

		expect(html).toContain('There are no mountains on the atlas yet.');
		expect(html).not.toContain('All mountains</h2>');
		expect(html).toContain('Preparing the atlas...');
	});

	it('renders the failure without a stage, with a retry', () => {
		const html = render({ model: { kind: 'error', reason: 'unreachable' }, canonicalUrl: null });

		expect(textsOf(html, 'h1')).toEqual(["We couldn't load the atlas"]);
		expect(html).toContain('Try again');
		expect(html).not.toContain('Preparing the atlas...');
		expect(countOf(html, 'main')).toBe(1);
	});
});
