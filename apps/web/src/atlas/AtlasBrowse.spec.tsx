import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MountainIndexEntry } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import { anchorsOf, textsOf } from '../mountain-page/test-support/markup';
import { TestExperience } from '../test/TestExperience';
import { TestRouter } from '../test/TestRouter';
import { AtlasControls } from './AtlasControls';
import { settleFilters, type AtlasFilters } from './atlasFilter';
import { AtlasList } from './AtlasList';
import { AtlasPanel } from './AtlasPanel';
import { groupByContinent } from './groupByContinent';
import { AtlasViewProvider, useAtlasBrowse, type AtlasBrowse } from './AtlasViewContext';
import { AtlasViewStore } from './AtlasViewStore';
import { toAtlasMarkers } from './toAtlasMarkers';
import { choiceIsCurrent, type MarkerChoice } from './useMarkerActivation';

const ANDES = { slug: 'andes', name: 'Andes' };
const ASIA = { code: 'AS', name: 'Asia' };
const SOUTH_AMERICA = { code: 'SA', name: 'South America' };

const CATALOG: MountainIndexEntry[] = [
	indexEntry('aconcagua', 'Aconcagua', {
		continent: SOUTH_AMERICA,
		countries: [{ code: 'AR', name: 'Argentina' }],
		elevationMeters: 6961,
		region: { slug: 'principal-cordillera', name: 'Principal Cordillera', ancestors: [ANDES] }
	}),
	indexEntry('fitz-roy', 'Fitz Roy', {
		continent: SOUTH_AMERICA,
		countries: [
			{ code: 'AR', name: 'Argentina' },
			{ code: 'CL', name: 'Chile' }
		],
		elevationMeters: 3405,
		region: { slug: 'patagonian-andes', name: 'Patagonian Andes', ancestors: [ANDES] }
	}),
	indexEntry('everest', 'Mount Everest', {
		continent: ASIA,
		countries: [{ code: 'NP', name: 'Nepal' }],
		elevationMeters: 8849
	})
];

const slugs = (list: readonly { slug: string }[]) => list.map(({ slug }) => slug);

function browseOf(store: AtlasViewStore, mountains = CATALOG): AtlasBrowse {
	let browse: AtlasBrowse | undefined;
	function Probe() {
		browse = useAtlasBrowse(store, mountains);
		return null;
	}
	renderToStaticMarkup(<Probe />);

	return browse!;
}

function renderPanel(store: AtlasViewStore): string {
	return renderToStaticMarkup(
		<TestRouter pathname="/atlas">
			<TestExperience>
				<AtlasViewProvider value={store}>
					<AtlasPanel mountains={CATALOG} />
				</AtlasViewProvider>
			</TestExperience>
		</TestRouter>
	);
}

describe('the atlas as the view shows it', () => {
	it('is the whole catalog, untouched, while the view is the default', () => {
		const browse = browseOf(new AtlasViewStore());

		expect(browse.isDefault).toBe(true);
		expect(browse.matches).toBe(CATALOG);
		expect(slugs(browse.results)).toEqual(slugs(CATALOG));
	});

	it('matches by filters in catalog order, and orders the results by the sort', () => {
		const store = new AtlasViewStore();
		store.setFilters({ range: 'andes' });
		store.setSort('elevation-asc');
		const browse = browseOf(store);

		expect(browse.isDefault).toBe(false);
		expect(slugs(browse.matches)).toEqual(['aconcagua', 'fitz-roy']);
		expect(slugs(browse.results)).toEqual(['fitz-roy', 'aconcagua']);
	});

	it('keeps what the globe draws apart from the order of the list', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR' });
		const before = browseOf(store).matches;

		store.setSort('elevation-desc');

		expect(browseOf(store).matches).toEqual(before);
	});

	it('draws a marker for each match only, and every marker again once the filters clear', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'NP' });
		expect(slugs(toAtlasMarkers(browseOf(store).matches))).toEqual(['everest']);

		store.setFilters({ country: 'CL' });
		expect(slugs(toAtlasMarkers(browseOf(store).matches))).toEqual(['fitz-roy']);

		store.reset();
		expect(slugs(toAtlasMarkers(browseOf(store).matches))).toEqual(slugs(CATALOG));
	});

	it('keeps the list, the count and the markers on one set as choices are made and undone', () => {
		const store = new AtlasViewStore();
		const choose = (change: Partial<AtlasFilters>, key: keyof AtlasFilters) =>
			store.setFilters(
				settleFilters(CATALOG, { ...store.getSnapshot().filters, ...change }, key).filters
			);

		choose({ range: 'andes' }, 'range');
		choose({ elevationBands: [3000] }, 'elevationBands');
		choose({ country: 'NP' }, 'country');

		const browse = browseOf(store);
		expect(browse.view.filters).toEqual({ country: 'NP', elevationBands: [], range: null });
		expect(slugs(browse.results)).toEqual(['everest']);
		expect(slugs(toAtlasMarkers(browse.matches))).toEqual(slugs(browse.results));

		store.reset();
		expect(slugs(toAtlasMarkers(browseOf(store).matches))).toEqual(slugs(CATALOG));
	});

	it('draws the markers of the union of the selected bands, and of what country and range leave', () => {
		const store = new AtlasViewStore();
		const choose = (change: Partial<AtlasFilters>, key: keyof AtlasFilters) =>
			store.setFilters(
				settleFilters(CATALOG, { ...store.getSnapshot().filters, ...change }, key).filters
			);

		choose({ elevationBands: [3000, 8000] }, 'elevationBands');
		expect(slugs(toAtlasMarkers(browseOf(store).matches)).sort()).toEqual(['everest', 'fitz-roy']);

		choose({ country: 'CL' }, 'country');
		const browse = browseOf(store);
		expect(browse.view.filters.elevationBands).toEqual([3000]);
		expect(slugs(toAtlasMarkers(browse.matches))).toEqual(['fitz-roy']);
		expect(slugs(browse.results)).toEqual(slugs(toAtlasMarkers(browse.matches)));

		store.reset();
		expect(browseOf(store).view.filters.elevationBands).toEqual([]);
		expect(slugs(toAtlasMarkers(browseOf(store).matches))).toEqual(slugs(CATALOG));
	});

	it('settles a stored state no mountain satisfies, rather than drawing an empty globe', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'NP', range: 'andes' });
		const browse = browseOf(store);

		expect(browse.view.filters).toEqual({ country: 'NP', elevationBands: [], range: null });
		expect(slugs(toAtlasMarkers(browse.matches))).toEqual(['everest']);
	});

	it('shows a catalog without a selection it lacks, as if it had not been made', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'CL' });
		const smaller = CATALOG.filter(({ slug }) => slug !== 'fitz-roy');
		const browse = browseOf(store, smaller);

		expect(browse.view.filters.country).toBeNull();
		expect(browse.isDefault).toBe(true);
		expect(browse.matches).toBe(smaller);
	});
});

describe('atlas panel', () => {
	it('lists the continents, as before, for the default view; the controls need script', () => {
		const html = renderPanel(new AtlasViewStore());

		expect(textsOf(html, 'summary')).toEqual(['Asia1 mountain', 'South America2 mountains']);
		expect(html).not.toMatch(/<select|<button|aria-live/);
	});

	it('lists the matches flat and in order for a filtered or sorted view', () => {
		const store = new AtlasViewStore();
		store.setFilters({ range: 'andes' });
		store.setSort('elevation-desc');
		const html = renderPanel(store);

		expect(html).not.toContain('<details');
		expect(
			anchorsOf(html)
				.filter(({ href }) => href.startsWith('/mountains/'))
				.map(({ href }) => href)
		).toEqual(['/mountains/aconcagua', '/mountains/fitz-roy']);
		expect(html).toContain('Argentina and Chile · 3,405 m');
	});

	it('settles a stored state no mountain satisfies, and lists what is left', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'NP', range: 'andes' });
		const html = renderPanel(store);

		expect(anchorsOf(html).filter(({ href }) => href.startsWith('/mountains/'))).toHaveLength(1);
		expect(html).not.toContain('No mountains match these filters.');
	});

	it('still says, in words, when a list of results is empty, with no mountain links', () => {
		const html = renderToStaticMarkup(
			<TestRouter pathname="/atlas">
				<AtlasList groups={groupByContinent(CATALOG)} results={[]} />
			</TestRouter>
		);

		expect(html).toContain('No mountains match these filters.');
		expect(anchorsOf(html).filter(({ href }) => href.startsWith('/mountains/'))).toEqual([]);
	});
});

describe('atlas controls', () => {
	function renderControls(store: AtlasViewStore): string {
		return renderToStaticMarkup(<Controls store={store} />);
	}
	function Controls({ store }: { store: AtlasViewStore }) {
		const browse = useAtlasBrowse(store, CATALOG);

		return <AtlasControls browse={browse} store={store} mountains={CATALOG} />;
	}

	it('names each control, starts the filters collapsed and keeps every popup closed', () => {
		const html = renderControls(new AtlasViewStore());

		expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-label="Filter"/);
		expect(html).toMatch(/<div id="[^"]+" class="[^"]*panel[^"]*" hidden="">/);
		// No native select is left: sort, country and range open popups, and elevation ticks.
		expect(html).not.toContain('<select');
		expect(textsOf(html, 'label')).toEqual([]);
		expect(html.match(/aria-haspopup="listbox"/g)).toHaveLength(3);
		expect(
			html.match(/<button[^>]*aria-expanded="false"[^>]*aria-labelledby="[^"]+ [^"]+"/g)
		).toHaveLength(4);
		expect(html).not.toContain('popover');
		expect(html).not.toContain('role="combobox"');
		expect(html).not.toContain('type="checkbox"');
		// The one aria-controls is the filter toggle's, for its panel.
		expect(html.match(/aria-controls="/g)).toHaveLength(1);
	});

	it('shows what each filter holds on its closed button', () => {
		const store = new AtlasViewStore();
		let html = renderControls(store);
		expect(html).toContain('>All countries</span>');
		expect(html).toContain('>Any elevation</span>');
		expect(html).toContain('>All ranges</span>');

		store.setFilters({ country: 'AR', range: 'patagonian-andes', elevationBands: [3000, 6000] });
		html = renderControls(store);
		expect(html).toContain('>Argentina</span>');
		// Argentina's Patagonian Andes hold no 6,000 m mountain, so only the 3,000 m band stays.
		expect(html).toContain('>3,000–3,999 m</span>');
		// A nested range names where it sits, which the name alone leaves out.
		expect(html).toContain('>Patagonian Andes</span><span class="');
		expect(html).toContain('>Andes</span></span><svg');
		expect(html).toContain('aria-label="Filter, 3 active"');
	});

	it('offers countries alphabetically, elevation bands and ranges under their parents', () => {
		const { options } = browseOf(new AtlasViewStore());

		expect(options.countries.map(({ name, count }) => [name, count])).toEqual([
			['Argentina', 2],
			['Chile', 1],
			['Nepal', 1]
		]);
		expect(options.elevationBands).toEqual([
			{ floor: 8000, count: 1 },
			{ floor: 6000, count: 1 },
			{ floor: 3000, count: 1 }
		]);
		expect(
			options.ranges.map(({ name, depth, ancestors, count }) => [name, depth, ancestors, count])
		).toEqual([
			['Andes', 0, [], 2],
			['Patagonian Andes', 1, ['Andes'], 1],
			['Principal Cordillera', 1, ['Andes'], 1]
		]);
	});

	it('offers each filter only what the others leave, with its counts', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'CL' });
		const { options } = browseOf(store);

		// Country is read without its own filter, the others against Chile.
		expect(options.countries.map(({ name, count }) => [name, count])).toEqual([
			['Argentina', 2],
			['Chile', 1],
			['Nepal', 1]
		]);
		expect(options.ranges.map(({ name, count }) => [name, count])).toEqual([
			['Andes', 1],
			['Patagonian Andes', 1]
		]);
		expect(options.elevationBands).toEqual([{ floor: 3000, count: 1 }]);
	});

	it('counts the matches against the catalog in a polite live region', () => {
		const store = new AtlasViewStore();
		expect(renderControls(store)).toMatch(/aria-live="polite"[^>]*>Showing all 3 mountains</);

		store.setFilters({ country: 'CL' });

		expect(renderControls(store)).toMatch(/aria-live="polite"[^>]*>Showing 1 of 3 mountains</);
	});

	it('offers a reset only once the view has left the default, and counts active filters', () => {
		const store = new AtlasViewStore();
		expect(renderControls(store)).not.toContain('Reset');

		store.setSort('elevation-desc');
		expect(renderControls(store)).toContain('aria-label="Reset filters and sort"');
		expect(renderControls(store)).toContain('aria-label="Filter"');

		store.setFilters({ country: 'AR', range: 'andes' });
		const html = renderControls(store);
		expect(html).toContain('aria-label="Filter, 2 active"');
		expect(html).toContain('>Argentina</span>');
		expect(html).toContain('>Highest first</span>');
	});
});

describe('a chooser left open on the globe', () => {
	const choice: MarkerChoice = {
		kind: 'choice',
		at: { x: 10, y: 10 },
		mountains: [
			{ slug: 'aconcagua', name: 'Aconcagua', elevationMeters: 6961 },
			{ slug: 'fitz-roy', name: 'Fitz Roy', elevationMeters: 3405 }
		]
	};

	it('stays while every mountain it lists is still drawn', () => {
		expect(choiceIsCurrent(choice, toAtlasMarkers(CATALOG))).toBe(true);
	});

	it('is stale as soon as the filters remove any mountain it lists', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'CL' });

		expect(choiceIsCurrent(choice, toAtlasMarkers(browseOf(store).matches))).toBe(false);
		expect(choiceIsCurrent(choice, [])).toBe(false);
	});
});
