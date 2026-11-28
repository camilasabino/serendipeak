import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MountainIndexEntry } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import { anchorsOf, textsOf } from '../mountain-page/test-support/markup';
import { TestExperience } from '../test/TestExperience';
import { TestRouter } from '../test/TestRouter';
import { UnitPreferenceProvider } from '../units/UnitPreferenceContext';
import { fixedPreference } from '../units/test-support';
import type { UnitSystem } from '../units/unitSystem';
import { AtlasControls } from './AtlasControls';
import { NO_FILTERS, settleFilters, type AtlasFilters } from './atlasFilter';
import { AtlasList } from './AtlasList';
import { AtlasPanel } from './AtlasPanel';
import { groupByContinent } from './groupByContinent';
import { AtlasViewProvider, useAtlasBrowse, type AtlasBrowse } from './AtlasViewContext';
import { AtlasViewStore } from './AtlasViewStore';
import { bandSelection } from './elevationBands';
import { rangePlace } from './rangeNavigation';
import { toAtlasMarkers } from './toAtlasMarkers';
import { toAtlasView } from './toAtlasView';
import { useAtlasChoice, type AtlasChoice } from './useAtlasChoice';
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
const m = (...floors: number[]) => bandSelection('metric', floors);
const ft = (...floors: number[]) => bandSelection('imperial', floors);

function browseOf(
	store: AtlasViewStore,
	mountains = CATALOG,
	system: UnitSystem = 'metric'
): AtlasBrowse {
	let browse: AtlasBrowse | undefined;
	function Probe() {
		browse = useAtlasBrowse(store, mountains);
		return null;
	}
	renderToStaticMarkup(
		<UnitPreferenceProvider value={fixedPreference(system)}>
			<Probe />
		</UnitPreferenceProvider>
	);

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
		choose({ elevationBands: m(3000) }, 'elevationBands');
		choose({ country: 'NP' }, 'country');

		const browse = browseOf(store);
		expect(browse.view.filters).toEqual({ country: 'NP', elevationBands: null, range: null });
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

		choose({ elevationBands: m(3000, 8000) }, 'elevationBands');
		expect(slugs(toAtlasMarkers(browseOf(store).matches)).sort()).toEqual(['everest', 'fitz-roy']);

		choose({ country: 'CL' }, 'country');
		const browse = browseOf(store);
		expect(browse.view.filters.elevationBands).toEqual(m(3000));
		expect(slugs(toAtlasMarkers(browse.matches))).toEqual(['fitz-roy']);
		expect(slugs(browse.results)).toEqual(slugs(toAtlasMarkers(browse.matches)));

		store.reset();
		expect(browseOf(store).view.filters.elevationBands).toBeNull();
		expect(slugs(toAtlasMarkers(browseOf(store).matches))).toEqual(slugs(CATALOG));
	});

	it('settles a stored state no mountain satisfies, rather than drawing an empty globe', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'NP', range: 'andes' });
		const browse = browseOf(store);

		expect(browse.view.filters).toEqual({ country: 'NP', elevationBands: null, range: null });
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

describe('browsing a mountain range', () => {
	const place = (store: AtlasViewStore) => {
		const browse = browseOf(store);

		return { browse, place: rangePlace(browse.options.ranges, browse.view.filters.range ?? '') };
	};

	it('lists, draws and counts the same mountains, those of the subranges included', () => {
		const store = new AtlasViewStore();
		store.setFilters({ range: 'andes' });
		const { browse, place: andes } = place(store);

		expect(andes?.range.count).toBe(browse.matches.length);
		expect(slugs(browse.results)).toEqual(['aconcagua', 'fitz-roy']);
		expect(slugs(browse.matches)).toEqual(slugs(browse.results));
		expect(toAtlasView(browse.view, CATALOG, browse.matches).focus).toHaveLength(2);
	});

	it('moves down and back up the trail on the one range filter, whatever else is chosen', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR', range: 'andes' });
		store.setFilters({ range: 'principal-cordillera' });
		expect(slugs(browseOf(store).matches)).toEqual(['aconcagua']);
		expect(store.getSnapshot().filters.country).toBe('AR');

		store.setFilters({ range: 'andes' });
		expect(slugs(browseOf(store).matches)).toEqual(['aconcagua', 'fitz-roy']);

		store.setFilters({ range: null });
		expect(browseOf(store).view.filters).toEqual({
			country: 'AR',
			elevationBands: null,
			range: null
		});
	});

	it('offers only the subranges the other filters leave', () => {
		const store = new AtlasViewStore();
		store.setFilters({ range: 'andes', elevationBands: m(3000) });
		const { place: andes } = place(store);

		expect(andes?.subranges.map(({ slug }) => slug)).toEqual(['patagonian-andes']);
		expect(andes?.range.count).toBe(1);
	});

	it('has no place for a range the catalog no longer holds, and lists what is left', () => {
		const store = new AtlasViewStore();
		store.setFilters({ range: 'gone' });
		const { browse, place: gone } = place(store);

		expect(gone).toBeUndefined();
		expect(browse.view.filters.range).toBeNull();
		expect(browse.matches).toHaveLength(CATALOG.length);
	});
});

describe('the atlas as the displayed unit changes', () => {
	it('offers the displayed system’s own bands when no band is selected, and nothing else moves', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR' });
		store.setSort('elevation-desc');
		const inMeters = browseOf(store, CATALOG, 'metric');
		const inFeet = browseOf(store, CATALOG, 'imperial');

		expect(inMeters.options.elevationBands.map(({ floor }) => floor)).toEqual([6000, 3000]);
		expect(inFeet.options.elevationBands.map(({ floor }) => floor)).toEqual([22_000, 11_000]);
		expect(inFeet.view).toEqual(inMeters.view);
		expect(inFeet.view.filters).toBe(store.getSnapshot().filters);
		expect(inFeet.options.countries).toEqual(inMeters.options.countries);
		expect(inFeet.options.ranges).toEqual(inMeters.options.ranges);
		expect(slugs(inFeet.results)).toEqual(slugs(inMeters.results));
	});

	it('leaves the matches, the filters and the framing untouched when no band is selected', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR' });
		const before = browseOf(store, CATALOG, 'metric');
		const framingBefore = toAtlasView(before.view, CATALOG, before.matches);

		store.clearElevationForUnits();
		const after = browseOf(store, CATALOG, 'imperial');

		expect(after.view.filters).toBe(before.view.filters);
		expect(slugs(after.matches)).toEqual(slugs(before.matches));
		expect(toAtlasView(after.view, CATALOG, after.matches)).toEqual(framingBefore);
	});

	it('frames the places the remaining filters leave once the bands are cleared', () => {
		const store = new AtlasViewStore();
		store.setFilters({ country: 'AR', elevationBands: m(6000) });
		const narrowed = browseOf(store, CATALOG, 'metric');

		store.clearElevationForUnits();
		const cleared = browseOf(store, CATALOG, 'imperial');

		expect(slugs(narrowed.matches)).toEqual(['aconcagua']);
		expect(slugs(cleared.matches)).toEqual(['aconcagua', 'fitz-roy']);
		expect(cleared.view.filters.country).toBe('AR');
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

	it('keeps the introduction for the first level, and shrinks the name to a label beyond it', () => {
		const first = renderPanel(new AtlasViewStore());
		const store = new AtlasViewStore();
		store.setSort('elevation-desc');
		const flat = renderPanel(store);

		expect(first).toContain('Explore 3 mountains on the globe');
		expect(first).not.toContain('titleCompact');
		expect(flat).not.toContain('Explore 3 mountains');
		expect(flat).toMatch(/<h1[^>]*class="[^"]*titleCompact[^"]*">Atlas<\/h1>/);
		expect(textsOf(first, 'h1')).toEqual(['Atlas']);
		expect(textsOf(flat, 'h1')).toEqual(['Atlas']);
	});

	it('says what the flat list is: all mountains, or only those the filters leave, and its order', () => {
		const headingOf = (change: (store: AtlasViewStore) => void) => {
			const store = new AtlasViewStore();
			change(store);

			return textsOf(renderPanel(store), 'h2');
		};

		expect(headingOf((store) => store.setSort('elevation-desc'))).toEqual([
			'All mountains · Highest first'
		]);
		expect(headingOf((store) => store.setSort('elevation-asc'))).toEqual([
			'All mountains · Lowest first'
		]);
		expect(headingOf((store) => store.setFilters({ country: 'AR' }))).toEqual([
			'Filtered mountains'
		]);
		expect(
			headingOf((store) => {
				store.setFilters({ country: 'AR' });
				store.setSort('elevation-desc');
			})
		).toEqual(['Filtered mountains · Highest first']);
		expect(headingOf(() => {})).toEqual(['All continents']);
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
	function renderControls(store: AtlasViewStore, system: UnitSystem = 'metric'): string {
		return renderToStaticMarkup(
			<UnitPreferenceProvider value={fixedPreference(system)}>
				<Controls store={store} />
			</UnitPreferenceProvider>
		);
	}
	function Controls({ store }: { store: AtlasViewStore }) {
		const browse = useAtlasBrowse(store, CATALOG);
		const choice = useAtlasChoice(store, CATALOG, browse.view);

		return <AtlasControls browse={browse} store={store} mountains={CATALOG} choice={choice} />;
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

		store.setFilters({ country: 'AR', range: 'patagonian-andes', elevationBands: m(3000, 6000) });
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

	it('names the selected bands on the closed Elevation button', () => {
		const store = new AtlasViewStore();
		store.setFilters({ elevationBands: ft(22_000, 29_000) });
		expect(renderControls(store, 'imperial')).toContain('>2 elevation bands</span>');

		store.setFilters({ elevationBands: ft(29_000) });
		expect(renderControls(store, 'imperial')).toContain('>29,000–29,999 ft</span>');
		expect(renderControls(store, 'imperial')).toContain('aria-label="Filter, 1 active"');
	});

	it('shows each active filter as a chip that removes it, named by the filter and its value', () => {
		const store = new AtlasViewStore();
		expect(renderControls(store)).not.toContain('Active filters');

		store.setFilters({ country: 'AR', elevationBands: m(3000), range: 'patagonian-andes' });
		const html = renderControls(store);
		const chips = [
			...html.matchAll(/<button[^>]*aria-label="(Remove [^"]+)"[^>]*>(.*?)<\/button>/g)
		];

		expect(html).toMatch(/<ul class="[^"]*chips[^"]*" aria-label="Active filters">/);
		expect(chips.map(([, name]) => name)).toEqual([
			'Remove Country: Argentina',
			'Remove Elevation: 3,000–3,999 m',
			'Remove Mountain range: Patagonian Andes'
		]);
		expect(chips.map(([, , content]) => content?.replace(/<[^>]*>/g, ''))).toEqual([
			'Argentina',
			'3,000–3,999 m',
			'Patagonian Andes'
		]);
		// The chips read the filters, as the toggle's count does, and keep no selection of their own.
		expect(html).toContain('aria-label="Filter, 3 active"');
		expect(html).toMatch(/<button[^>]*class="[^"]*toggle[^"]*"[^>]*data-active="true"/);
	});

	it('marks a filter that is on, and leaves one that is off plain', () => {
		const store = new AtlasViewStore();
		expect(renderControls(store)).not.toContain('data-active');

		store.setFilters({ country: 'AR' });
		const html = renderControls(store);

		expect(html.match(/class="[^"]*trigger[^"]*"[^>]*data-active="true"/g)).toHaveLength(1);
	});

	it('explains, and does not open, a filter with nothing to choose between while it is off', () => {
		const store = new AtlasViewStore();
		expect(renderControls(store)).not.toContain('aria-disabled');

		store.setFilters({ range: 'patagonian-andes' });
		const html = renderControls(store);

		// The one mountain in the range has one band and the same countries: nothing narrows. The
		// range itself is also a place to go, so that filter stays open.
		expect(html.match(/aria-disabled="true"/g)).toHaveLength(2);
		expect(html).toContain('>No other countries here<');
		expect(html).toContain('>No other elevation bands here<');
		expect(html).not.toContain('No ranges here');
		expect(html.match(/aria-describedby="/g)).toHaveLength(2);
	});

	it('keeps a selection reachable even when it is the only choice left', () => {
		const store = new AtlasViewStore();
		store.setFilters({ range: 'patagonian-andes', country: 'CL' });
		const html = renderControls(store);

		expect(html).not.toContain('No other countries here');
		expect(html).toContain('>Chile</span>');
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

describe('filter options as the reader navigates', () => {
	const EUROPE = { code: 'EU', name: 'Europe' };
	const SOUTHERN = { slug: 'southern-andes', name: 'Southern Andes' };
	const CAUCASUS = { slug: 'caucasus', name: 'Caucasus', ancestors: [] };
	const RU = { code: 'RU', name: 'Russia' };
	const GE = { code: 'GE', name: 'Georgia' };

	const WORLD: MountainIndexEntry[] = [
		indexEntry('aconcagua', 'Aconcagua', {
			continent: SOUTH_AMERICA,
			countries: [{ code: 'AR', name: 'Argentina' }],
			elevationMeters: 6961,
			region: {
				slug: 'principal-cordillera',
				name: 'Principal Cordillera',
				ancestors: [ANDES, SOUTHERN]
			}
		}),
		indexEntry('ojos-del-salado', 'Ojos del Salado', {
			continent: SOUTH_AMERICA,
			countries: [
				{ code: 'AR', name: 'Argentina' },
				{ code: 'CL', name: 'Chile' }
			],
			elevationMeters: 6893,
			region: { ...SOUTHERN, ancestors: [ANDES] }
		}),
		indexEntry('chimborazo', 'Chimborazo', {
			continent: SOUTH_AMERICA,
			countries: [{ code: 'EC', name: 'Ecuador' }],
			elevationMeters: 6263,
			region: { slug: 'northern-andes', name: 'Northern Andes', ancestors: [ANDES] }
		}),
		indexEntry('elbrus', 'Mount Elbrus', {
			continent: EUROPE,
			countries: [RU],
			elevationMeters: 5642,
			region: CAUCASUS
		}),
		indexEntry('kazbek', 'Mount Kazbek', {
			continent: ASIA,
			countries: [GE, RU],
			elevationMeters: 5054,
			region: CAUCASUS
		}),
		indexEntry('everest', 'Mount Everest', {
			continent: ASIA,
			countries: [{ code: 'NP', name: 'Nepal' }],
			elevationMeters: 8849
		})
	];

	/** One render of the atlas as a reader sees it; each step reads a fresh one, as React would. */
	function atlas(store: AtlasViewStore): { browse: AtlasBrowse; choice: AtlasChoice } {
		let browse: AtlasBrowse | undefined;
		let choice: AtlasChoice | undefined;
		function Probe() {
			browse = useAtlasBrowse(store, WORLD);
			choice = useAtlasChoice(store, WORLD, browse.view);
			return null;
		}
		renderToStaticMarkup(
			<UnitPreferenceProvider value={fixedPreference('metric')}>
				<Probe />
			</UnitPreferenceProvider>
		);

		return { browse: browse!, choice: choice! };
	}
	const countries = (store: AtlasViewStore) =>
		atlas(store).browse.options.countries.map(({ code }) => code);
	const ranges = (store: AtlasViewStore) =>
		atlas(store).browse.options.ranges.map(({ slug }) => slug);
	const ALL_COUNTRIES = ['AR', 'CL', 'EC', 'GE', 'NP', 'RU'];
	const ALL_RANGES = [
		'andes',
		'northern-andes',
		'southern-andes',
		'principal-cordillera',
		'caucasus'
	];

	it('offers the whole catalog across all continents', () => {
		const store = new AtlasViewStore();

		expect(countries(store)).toEqual(ALL_COUNTRIES);
		expect(ranges(store)).toEqual(ALL_RANGES);
	});

	it('offers a continent only its own countries and ranges, on its mountains or its ranges', () => {
		const store = new AtlasViewStore();
		atlas(store).choice.browseContinent({ code: 'SA', ranges: false });
		expect(countries(store)).toEqual(['AR', 'CL', 'EC']);
		expect(ranges(store)).toEqual([
			'andes',
			'northern-andes',
			'southern-andes',
			'principal-cordillera'
		]);

		atlas(store).choice.browseContinent({ code: 'SA', ranges: true });
		expect(countries(store)).toEqual(['AR', 'CL', 'EC']);
	});

	it('offers a range and a subrange only what lies within, the way down and back up', () => {
		const store = new AtlasViewStore();
		atlas(store).choice.browseContinent({ code: 'SA', ranges: true });
		atlas(store).choice.choose({ range: 'andes' });
		expect(countries(store)).toEqual(['AR', 'CL', 'EC']);

		atlas(store).choice.choose({ range: 'southern-andes' });
		expect(countries(store)).toEqual(['AR', 'CL']);
		expect(ranges(store)).toEqual(['southern-andes', 'principal-cordillera']);
		// The trail still climbs past what the filter offers.
		const { browse } = atlas(store);
		expect(rangePlace(browse.ranges, 'southern-andes')?.trail.map(({ slug }) => slug)).toEqual([
			'andes',
			'southern-andes'
		]);

		atlas(store).choice.choose({ range: 'andes' });
		expect(countries(store)).toEqual(['AR', 'CL', 'EC']);

		atlas(store).choice.browseContinent({ code: 'SA', ranges: true });
		expect(countries(store)).toEqual(['AR', 'CL', 'EC']);

		atlas(store).choice.browseContinent(null);
		expect(countries(store)).toEqual(ALL_COUNTRIES);
		expect(ranges(store)).toEqual(ALL_RANGES);
	});

	it('offers a range across continents every country it holds, wherever it was reached from', () => {
		const store = new AtlasViewStore();
		atlas(store).choice.browseContinent({ code: 'EU', ranges: true });
		expect(countries(store)).toEqual(['RU']);

		atlas(store).choice.choose({ range: 'caucasus' });

		expect(countries(store)).toEqual(['GE', 'RU']);
		expect(slugs(atlas(store).browse.results)).toEqual(['elbrus', 'kazbek']);
	});

	it('keeps every selection that still holds where the reader goes', () => {
		const store = new AtlasViewStore();
		atlas(store).choice.browseContinent({ code: 'SA', ranges: true });
		atlas(store).choice.choose({ range: 'andes' });
		atlas(store).choice.choose({ country: 'CL' });
		atlas(store).choice.choose({ elevationBands: m(6000) });

		atlas(store).choice.browseContinent({ code: 'SA', ranges: true });
		atlas(store).choice.browseContinent(null);

		expect(atlas(store).browse.view.filters).toEqual({
			country: 'CL',
			elevationBands: m(6000),
			range: null
		});
	});

	it('lets a selection go back to all, and says so, when the continent cannot show it', () => {
		const store = new AtlasViewStore();
		atlas(store).choice.browseContinent({ code: 'EU', ranges: true });
		atlas(store).choice.choose({ range: 'caucasus' });
		atlas(store).choice.choose({ country: 'GE' });
		const settle = vi.spyOn(store, 'browseContinent');

		atlas(store).choice.browseContinent({ code: 'EU', ranges: true });

		// Georgia's mountain lies in Asia: Europe would list nothing under it.
		expect(settle).toHaveBeenCalledWith({ code: 'EU', ranges: true }, NO_FILTERS);
		expect(store.getSnapshot().filters).toEqual(NO_FILTERS);
		expect(countries(store)).toEqual(['RU']);
		expect(ranges(store)).toEqual(['caucasus']);
	});

	it('never leaves a selection the continent cannot show, however the state was reached', () => {
		const store = new AtlasViewStore();
		store.browseContinent({ code: 'EU', ranges: false });
		store.setFilters({ country: 'NP' });
		const { browse } = atlas(store);

		expect(browse.view.filters.country).toBeNull();
		expect(browse.options.countries.map(({ code }) => code)).toEqual(['RU']);
	});

	it('keeps the sort apart from the scope, and the scope apart from the sort', () => {
		const store = new AtlasViewStore();
		atlas(store).choice.browseContinent({ code: 'SA', ranges: false });
		const before = atlas(store).browse.options;

		store.setSort('elevation-desc');

		expect(atlas(store).browse.options).toEqual(before);
		expect(atlas(store).browse.view.continent).toEqual({ code: 'SA', ranges: false });
	});

	it('goes back to the whole catalog on reset', () => {
		const store = new AtlasViewStore();
		atlas(store).choice.browseContinent({ code: 'SA', ranges: true });
		atlas(store).choice.choose({ range: 'southern-andes' });
		atlas(store).choice.choose({ country: 'CL' });

		store.reset();

		expect(countries(store)).toEqual(ALL_COUNTRIES);
		expect(ranges(store)).toEqual(ALL_RANGES);
	});

	it('offers the same again after a visit to a mountain, the store outliving the atlas', () => {
		const store = new AtlasViewStore();
		atlas(store).choice.browseContinent({ code: 'SA', ranges: true });
		atlas(store).choice.choose({ range: 'southern-andes' });
		const before = atlas(store).browse;

		// The atlas unmounts and mounts again; only the stage layout's store carries over.
		const after = atlas(store).browse;

		expect(after.view).toEqual(before.view);
		expect(after.options).toEqual(before.options);
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
