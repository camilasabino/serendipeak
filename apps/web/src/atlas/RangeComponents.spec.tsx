import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MountainIndexEntry, Region } from '../api/contract';
import { indexEntry } from '../api/test-support/indexEntries';
import { anchorsOf, textsOf } from '../mountain-page/test-support/markup';
import { TestExperience } from '../test/TestExperience';
import { TestRouter } from '../test/TestRouter';
import { atlasOptions } from './atlasFilter';
import { AtlasList, type FlatList } from './AtlasList';
import { ContinentMountainsView, ContinentRangesView } from './ContinentRanges';
import { groupByContinent } from './groupByContinent';
import {
	rangePlace,
	rootRangesByContinent,
	type ContinentLevel,
	type RangeContinent,
	type RangeNavigation,
	type RangeOrigin
} from './rangeNavigation';
import { AtlasContext } from './AtlasContext';
import { RangeView } from './RangeView';

const ANDES = { slug: 'andes', name: 'Andes' };
const SOUTHERN_ANDES = { slug: 'southern-andes', name: 'Southern Andes' };
const SA = { code: 'SA', name: 'South America' };
const EU = { code: 'EU', name: 'Europe' };
const region = (slug: string, name: string, ...ancestors: Region['ancestors']): Region => ({
	slug,
	name,
	ancestors
});

const CATALOG: MountainIndexEntry[] = [
	indexEntry('aconcagua', 'Aconcagua', {
		continent: SA,
		region: region('principal-cordillera', 'Principal Cordillera', ANDES, SOUTHERN_ANDES)
	}),
	indexEntry('chimborazo', 'Chimborazo', { continent: SA, region: region('andes', 'Andes') }),
	indexEntry('triglav', 'Triglav', { region: region('triglav-group', 'Triglav Group') })
];

const ranges = atlasOptions(CATALOG, 'metric').ranges;
const noop = () => {};

const buttonLabels = (html: string) =>
	[...html.matchAll(/<button[^>]*>(.*?)<\/button>/gs)].map((match) =>
		(match[1] ?? '').replace(/<[^>]*>/g, '')
	);

describe('AtlasContext', () => {
	const step = (label: string, accessibleLabel?: string) => ({
		label,
		accessibleLabel,
		onSelect: noop
	});

	it('sets one prominent heading for the level, focusable so arriving can move focus to it', () => {
		const html = renderToStaticMarkup(<AtlasContext heading="Andes" steps={[step('Atlas')]} />);

		expect(textsOf(html, 'h2')).toEqual(['Andes']);
		expect(html).toMatch(/<h2 id="atlas-list-heading" tabindex="-1"/);
		expect(html).not.toContain('<h1');
		expect(html).not.toContain('<h3');
	});

	it('lays the way up before the heading, every place a button, the last named for going back', () => {
		const html = renderToStaticMarkup(
			<AtlasContext
				heading="Principal Cordillera"
				steps={[step('South America mountain ranges'), step('Andes')]}
			/>
		);

		expect(html).toMatch(/<nav aria-label="Atlas trail">/);
		expect(html.indexOf('<nav')).toBeLessThan(html.indexOf('<h2'));
		expect(textsOf(html, 'li')).toEqual(['South America mountain ranges', '›Andes']);
		expect(buttonLabels(html)).toEqual(['South America mountain ranges', 'Andes']);
		expect(html).toContain('aria-label="Back to Andes"');
		expect(html).not.toContain('aria-label="Back to South America');
		expect(html).not.toContain('aria-current');
	});

	it('names the level once, in its heading, and not in the trail', () => {
		const html = renderToStaticMarkup(
			<AtlasContext heading="Principal Cordillera" steps={[step('Andes')]} />
		);

		expect(html.match(/Principal Cordillera/g)).toHaveLength(1);
	});

	it('says a step does more than go up in its own words', () => {
		const html = renderToStaticMarkup(
			<AtlasContext
				heading="Filtered mountains"
				steps={[step('Browse by continent', 'Browse by continent, clearing filters and sort')]}
			/>
		);

		expect(html).toContain('aria-label="Browse by continent, clearing filters and sort"');
	});

	it('says how many mountains a level holds when that is worth saying, and nothing else', () => {
		const html = renderToStaticMarkup(
			<AtlasContext heading="Andes" meta="2 mountains · Asia" steps={[]} />
		);

		expect(textsOf(html, 'p')).toEqual(['2 mountains · Asia']);
		expect(html).not.toContain('<nav');
		expect(renderToStaticMarkup(<AtlasContext heading="Andes" steps={[]} />)).not.toContain('<p');
	});

	it('sets the first level’s heading apart as a quiet label, with no way up', () => {
		const html = renderToStaticMarkup(<AtlasContext heading="All continents" steps={[]} initial />);

		expect(html).toMatch(/<h2[^>]*class="[^"]*quietHeading/);
		expect(renderToStaticMarkup(<AtlasContext heading="Andes" steps={[]} />)).not.toContain(
			'quietHeading'
		);
	});
});

describe('RangeView', () => {
	function render(slug: string): string {
		return renderToStaticMarkup(
			<RangeView subranges={rangePlace(ranges, slug)!.subranges} onChoose={noop}>
				<ul data-mountains="" />
			</RangeView>
		);
	}

	it('offers each direct subrange as a button with its count, apart from the mountains it holds', () => {
		const html = render('andes');

		expect(textsOf(html, 'h3')).toEqual(['Subranges', 'Mountains']);
		expect(buttonLabels(html)).toEqual(['Southern Andes1 mountain']);
		expect(html.indexOf('Subranges')).toBeLessThan(html.indexOf('data-mountains'));
		expect(html.indexOf('data-mountains')).toBeGreaterThan(html.indexOf('>Mountains<'));
	});

	it('keeps a range without subranges to its mountains alone', () => {
		const html = render('triglav-group');

		expect(textsOf(html, 'h3')).toEqual([]);
		expect(html).not.toContain('Subranges');
		expect(html).toContain('data-mountains');
	});
});

describe('ContinentMountainsView', () => {
	function render(hasRanges: boolean): string {
		return renderToStaticMarkup(
			<ContinentMountainsView continent={EU} hasRanges={hasRanges} onBrowseRanges={noop}>
				<ul data-mountains="" />
			</ContinentMountainsView>
		);
	}

	it('offers the way into the ranges, naming the continent for assistive technology', () => {
		const html = render(true);

		expect(html).toContain('aria-label="Browse mountain ranges in Europe"');
		expect(buttonLabels(html)).toEqual(['Browse mountain ranges']);
		expect(html).toContain('data-mountains');
	});

	it('offers no way into ranges a continent does not have', () => {
		expect(buttonLabels(render(false))).toEqual([]);
	});
});

describe('ContinentRangesView', () => {
	it('lists a range of a single mountain like any other', () => {
		const html = renderToStaticMarkup(
			<ContinentRangesView
				ranges={rootRangesByContinent(CATALOG, ranges).get('EU') ?? []}
				onChoose={noop}
			/>
		);

		expect(buttonLabels(html)).toEqual(['Triglav Group1 mountain']);
	});

	it('says so when the filters leave the continent no range', () => {
		const html = renderToStaticMarkup(<ContinentRangesView ranges={[]} onChoose={noop} />);

		expect(textsOf(html, 'p')).toEqual(['No mountain ranges here match the current filters.']);
		expect(buttonLabels(html)).toEqual([]);
	});
});

describe('AtlasList with ranges', () => {
	const groups = groupByContinent(CATALOG);
	const byContinent = rootRangesByContinent(CATALOG, ranges);
	const level = (continent: RangeContinent, showRanges: boolean): ContinentLevel => ({
		...continent,
		showRanges,
		ranges: byContinent.get(continent.code) ?? [],
		mountains: CATALOG.filter(({ continent: of }) => of.code === continent.code)
	});
	const navigation = (
		slug: string | null,
		continent: ContinentLevel | undefined = undefined,
		origin: RangeOrigin | null = { ...SA, ranges: true },
		atlasLabel = 'All continents'
	): RangeNavigation => ({
		byContinent,
		continent,
		place: slug === null ? undefined : rangePlace(ranges, slug),
		origin: origin ?? undefined,
		atlasLabel,
		choose: noop,
		browseContinent: noop
	});
	function render(
		ranges?: RangeNavigation,
		results?: readonly MountainIndexEntry[],
		flat?: FlatList,
		toolbar?: string
	): string {
		return renderToStaticMarkup(
			<TestRouter pathname="/atlas">
				<TestExperience>
					<AtlasList
						groups={groups}
						results={results}
						ranges={ranges}
						flat={flat}
						toolbar={toolbar && <p data-toolbar="">{toolbar}</p>}
					/>
				</TestExperience>
			</TestRouter>
		);
	}

	it('serves every continent with its mountains as links until the page is interactive', () => {
		const html = render();

		expect(html).not.toContain('ranges');
		expect(html).not.toContain('<button');
		expect(textsOf(html, 'summary')).toEqual(['Europe1 mountain', 'South America2 mountains']);
		expect(
			anchorsOf(html)
				.map(({ href }) => href)
				.sort()
		).toEqual(['/mountains/aconcagua', '/mountains/chimborazo', '/mountains/triglav']);
	});

	it('keeps one stable name for the section, whatever level its heading names', () => {
		for (const html of [
			render(),
			render(navigation(null, level(SA, false))),
			render(navigation('andes'), [CATALOG[0]!]),
			render(navigation(null), [CATALOG[0]!])
		]) {
			expect(html).toMatch(/<section[^>]*aria-label="Atlas mountains"/);
			expect(html).not.toContain('aria-labelledby="atlas-list-heading"><h');
		}
	});

	it('names the first level all continents, never all mountains, as a quiet label', () => {
		for (const html of [render(), render(navigation(null))]) {
			expect(textsOf(html, 'h2')).toEqual(['All continents']);
			expect(html).toMatch(/<h2[^>]*class="[^"]*quietHeading/);
			expect(html).not.toContain('All mountains');
			expect(html).not.toContain('<nav');
		}
	});

	it('lists only the continents, as entries with their counts, once the page is interactive', () => {
		const html = render(navigation(null));

		expect(textsOf(html, 'button')).toEqual(['Europe1 mountain', 'South America2 mountains']);
		expect(html).not.toContain('<details');
		expect(anchorsOf(html)).toEqual([]);
	});

	it('shows one continent’s mountains alone, with where it is, how many, and the way into its ranges', () => {
		const html = render(navigation(null, level(SA, false)));

		expect(textsOf(html, 'h2')).toEqual(['South America mountains']);
		expect(textsOf(html, 'p')).toEqual(['2 mountains']);
		expect(textsOf(html, 'button')).toEqual(['All continents', 'Browse mountain ranges']);
		expect(html).toContain('aria-label="Back to All continents"');
		expect(anchorsOf(html).map(({ href }) => href)).toEqual([
			'/mountains/aconcagua',
			'/mountains/chimborazo'
		]);
		expect(html).toMatch(/<ul[^>]*aria-labelledby="atlas-list-heading"/);
	});

	it('goes back from a continent to what the atlas is with the filters it keeps', () => {
		const html = render(navigation(null, level(SA, false), undefined, 'Filtered mountains'));

		expect(buttonLabels(html)[0]).toBe('Filtered mountains');
		expect(html).toContain('aria-label="Back to Filtered mountains"');
	});

	it('shows a continent’s ranges in place of its mountains, with its mountains one step back', () => {
		const html = render(navigation(null, level(EU, true)));

		expect(textsOf(html, 'h2')).toEqual(['Europe mountain ranges']);
		expect(textsOf(html, 'button')).toEqual(['Europe mountains', 'Triglav Group1 mountain']);
		expect(html).toContain('aria-label="Back to Europe mountains"');
		expect(anchorsOf(html)).toEqual([]);
		expect(html).toMatch(/<ul[^>]*aria-labelledby="atlas-list-heading"/);
	});

	it('says so when the filters leave a continent no mountain', () => {
		const html = render(navigation(null, { ...level(EU, false), mountains: [] }));

		expect(html).toContain('No mountains match');
	});

	it('shows a range with its subranges and its mountains, each in its subrange, and no continents', () => {
		const html = render(navigation('andes'), [CATALOG[0]!, CATALOG[1]!]);

		expect(textsOf(html, 'h2')).toEqual(['Andes']);
		expect(textsOf(html, 'h3')).toEqual(['Subranges', 'Mountains']);
		expect(textsOf(html, 'p')).toEqual(['2 mountains']);
		expect(html).not.toContain('<details');
		expect(html).toMatch(/<ul[^>]*aria-labelledby="atlas-range-mountains-heading"/);
		expect(textsOf(html, 'span').filter((text) => text.includes('Southern Andes ·'))).toHaveLength(
			1
		);
		expect(html).not.toContain('Principal Cordillera ·');
	});

	it('climbs from a range through the level the reader entered it by, then each range above', () => {
		const ranged = render(navigation('principal-cordillera'), [CATALOG[0]!]);
		const mountains = render(
			navigation('principal-cordillera', undefined, { ...SA, ranges: false }),
			[CATALOG[0]!]
		);

		expect(buttonLabels(ranged).slice(0, 3)).toEqual([
			'South America mountain ranges',
			'Andes',
			'Southern Andes'
		]);
		expect(ranged).toContain('aria-label="Back to Southern Andes"');
		expect(buttonLabels(mountains)[0]).toBe('South America mountains');
	});

	it('starts the way up at the atlas for a range with no continent behind it, inventing no step', () => {
		const direct = render(navigation('andes', undefined, null), [CATALOG[0]!]);
		const filtered = render(
			navigation('andes', undefined, null, 'Filtered mountains · Highest first'),
			[CATALOG[0]!]
		);

		expect(buttonLabels(direct)[0]).toBe('All continents');
		expect(direct).toContain('aria-label="Back to All continents"');
		expect(buttonLabels(filtered)[0]).toBe('Filtered mountains · Highest first');
		expect(direct).not.toContain('mountain ranges');
	});

	it('heads the flat results by what they are, and offers the way back to the continents', () => {
		const html = render(navigation(null), [CATALOG[0]!], {
			heading: 'Filtered mountains · Highest first',
			clearsFilters: true,
			onReturn: noop
		});

		expect(textsOf(html, 'h2')).toEqual(['Filtered mountains · Highest first']);
		expect(html).not.toContain('quietHeading');
		expect(textsOf(html, 'button')).toEqual(['Browse by continent']);
		expect(html).toContain('aria-label="Browse by continent, clearing filters and sort"');
		expect(html).toMatch(/<ul[^>]*aria-labelledby="atlas-list-heading"/);
		expect(html).not.toContain('<h3');
	});

	it('says only the sort is cleared when no filter is on, and offers no way back before the page is interactive', () => {
		const sorted = render(navigation(null), [CATALOG[0]!], {
			heading: 'All mountains · Highest first',
			clearsFilters: false,
			onReturn: noop
		});
		const early = render(undefined, [CATALOG[0]!], {
			heading: 'Filtered mountains',
			clearsFilters: true
		});

		expect(sorted).toContain('aria-label="Browse by continent, clearing sort"');
		expect(early).not.toContain('<button');
		expect(textsOf(early, 'h2')).toEqual(['Filtered mountains']);
	});

	it('sets where the reader is before the controls, at every level', () => {
		for (const html of [
			render(navigation(null), undefined, undefined, 'Controls'),
			render(navigation(null, level(SA, false)), undefined, undefined, 'Controls'),
			render(navigation(null, level(EU, true)), undefined, undefined, 'Controls'),
			render(navigation('andes'), [CATALOG[0]!], undefined, 'Controls'),
			render(navigation(null), [CATALOG[0]!], { heading: 'x', clearsFilters: true }, 'Controls')
		]) {
			expect(html.indexOf('<h2')).toBeGreaterThan(-1);
			expect(html.indexOf('<h2')).toBeLessThan(html.indexOf('data-toolbar'));
		}
	});
});
