import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { indexEntry } from '../api/test-support/indexEntries';
import { filterMountains, NO_FILTERS } from '../atlas/atlasFilter';
import { elevationBandLabel } from '../atlas/atlasCopy';
import { bandFloorOf, bandSelection } from '../atlas/elevationBands';
import { AtlasList } from '../atlas/AtlasList';
import { groupByContinent } from '../atlas/groupByContinent';
import { MarkerChooser } from '../atlas/MarkerChooser';
import { MountainInfoPanel } from '../mountain-page/MountainInfoPanel';
import { SearchCombobox } from '../search/SearchDialog';
import { TestRouter } from '../test/TestRouter';
import { UnitPreferenceProvider } from './UnitPreferenceContext';
import { fixedPreference } from './test-support';
import type { UnitSystem } from './unitSystem';
import type { ReactNode } from 'react';

const MONT_BLANC = indexEntry('mont-blanc', 'Mont Blanc', { elevationMeters: 4806 });
const complete = contractFixture('mountain-complete.json') as Mountain;

function within(system: UnitSystem | undefined, node: ReactNode): string {
	return renderToStaticMarkup(
		<TestRouter pathname="/atlas">
			<UnitPreferenceProvider value={system ? fixedPreference(system) : undefined}>
				{node}
			</UnitPreferenceProvider>
		</TestRouter>
	);
}

const surfaces: Array<[string, (system?: UnitSystem) => string]> = [
	['atlas rows', (s) => within(s, <AtlasList groups={groupByContinent([MONT_BLANC])} />)],
	[
		'search results',
		(s) =>
			within(
				s,
				<SearchCombobox
					state={{ status: 'ready', mountains: [MONT_BLANC] }}
					onSelect={() => {}}
					onRetry={() => {}}
					initialQuery="mont"
				/>
			)
	],
	[
		'marker chooser',
		(s) =>
			within(
				s,
				<MarkerChooser
					choice={{
						kind: 'choice',
						mountains: [{ slug: 'mont-blanc', name: 'Mont Blanc', elevationMeters: 4806 }],
						at: { x: 1, y: 1 }
					}}
					onClose={() => {}}
				/>
			)
	]
];

describe.each(surfaces)('%s', (_name, render) => {
	it('show meters without a provider and for the metric system', () => {
		expect(render()).toContain('4,806 m');
		expect(render('metric')).toContain('4,806 m');
	});

	it('show feet for the imperial system', () => {
		const html = render('imperial');

		expect(html).toContain('15,768 ft');
		expect(html).not.toContain('4,806');
	});
});

describe('MountainInfoPanel', () => {
	const panel = (system?: UnitSystem) =>
		within(system, <MountainInfoPanel mountain={{ ...complete, elevationMeters: 4806 }} />);

	it('shows the figure and unit in meters by default and in feet when imperial', () => {
		expect(panel()).toMatch(/>4,806<\/span> <span[^>]*>m<\/span>/);
		expect(panel('imperial')).toMatch(/>15,768<\/span> <span[^>]*>ft<\/span>/);
	});
});

describe('atlas elevation bands', () => {
	it('are 1,000 of the displayed unit, labelled in it', () => {
		expect(elevationBandLabel(4000, 'metric')).toBe('4,000–4,999 m');
		expect(elevationBandLabel(15_000, 'imperial')).toBe('15,000–15,999 ft');
	});

	it('filter on canonical meters, converted without rounding', () => {
		const high = indexEntry('high', 'High', { elevationMeters: 4806 });
		const low = indexEntry('low', 'Low', { elevationMeters: 3281 });

		expect(bandFloorOf(4806, 'metric')).toBe(4000);
		expect(bandFloorOf(4806, 'imperial')).toBe(15_000);
		expect(
			filterMountains([high, low], {
				...NO_FILTERS,
				elevationBands: bandSelection('metric', [4000])
			}).map((m) => m.slug)
		).toEqual(['high']);
		// 3,281 m is 10,764 ft.
		expect(
			filterMountains([high, low], {
				...NO_FILTERS,
				elevationBands: bandSelection('imperial', [10_000])
			}).map((m) => m.slug)
		).toEqual(['low']);
	});
});
