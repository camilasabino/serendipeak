import { describe, expect, it } from 'vitest';
import { indexEntry } from '../api/test-support/indexEntries';
import { ATLAS_VIEW } from '../stage/globe/atlasView';
import { NO_FILTERS } from './atlasFilter';
import { bandSelection } from './elevationBands';
import { toAtlasView } from './toAtlasView';

const ACONCAGUA = indexEntry('aconcagua', 'Aconcagua', {
	coordinates: { latitude: -32.653, longitude: -70.011 }
});
const FITZ_ROY = indexEntry('fitz-roy', 'Fitz Roy', {
	coordinates: { latitude: -49.271, longitude: -73.043 }
});

describe('toAtlasView', () => {
	it('keeps the overview when no filter is on, so the camera has nothing to answer', () => {
		expect(toAtlasView(NO_FILTERS, [ACONCAGUA, FITZ_ROY])).toBe(ATLAS_VIEW);
	});

	it.each(['metric', 'imperial'] as const)(
		'keeps the overview for %s elevation bands alone, which say nothing about where to look',
		(system) => {
			const filters = { ...NO_FILTERS, elevationBands: bandSelection(system, [6000]) };

			expect(toAtlasView(filters, [ACONCAGUA])).toBe(ATLAS_VIEW);
		}
	);

	it.each([
		['a country', { ...NO_FILTERS, country: 'AR' }],
		['a range', { ...NO_FILTERS, range: 'andes' }],
		['a country and a range', { ...NO_FILTERS, country: 'AR', range: 'andes' }],
		[
			'a country, a range and a band',
			{ country: 'AR', range: 'andes', elevationBands: bandSelection('metric', [3000]) }
		]
	])('frames the coordinates of the matches for %s', (_name, filters) => {
		const view = toAtlasView(filters, [ACONCAGUA, FITZ_ROY]);

		expect(view.center).toBe(ATLAS_VIEW.center);
		expect(view.focus).toEqual([
			{ latitude: -32.653, longitude: -70.011 },
			{ latitude: -49.271, longitude: -73.043 }
		]);
	});

	it('follows the matches when an elevation band narrows a geographic filter', () => {
		const filters = { country: 'AR', range: null, elevationBands: bandSelection('metric', [6000]) };

		expect(toAtlasView(filters, [ACONCAGUA]).focus).toEqual([
			{ latitude: -32.653, longitude: -70.011 }
		]);
	});

	it('keeps the overview when nothing matches, rather than framing nowhere', () => {
		expect(toAtlasView({ ...NO_FILTERS, country: 'AR' }, [])).toBe(ATLAS_VIEW);
	});
});
