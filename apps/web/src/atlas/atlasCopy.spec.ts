import { describe, expect, it } from 'vitest';
import {
	autoResetNotice,
	choicesFound,
	convertedBandLabel,
	elevationBandLabel,
	elevationSummary,
	noCountriesMessage,
	noRangesMessage,
	retainedBandsReplacedNotice
} from './atlasCopy';
import { bandSelection } from './elevationBands';

const m = (...floors: number[]) => bandSelection('metric', floors);
const ft = (...floors: number[]) => bandSelection('imperial', floors);

describe('autoResetNotice', () => {
	it('names the one filter that went back to all', () => {
		expect(autoResetNotice(['elevationBands'])).toBe(
			'Elevation (Any elevation) reset: no mountains matched with your choice.'
		);
	});

	it('names several in order, joined in words', () => {
		expect(autoResetNotice(['country', 'range'])).toBe(
			'Country (All countries) and Mountain range (All ranges) reset: no mountains matched with your choice.'
		);
		expect(autoResetNotice(['country', 'elevationBands', 'range'])).toContain(
			'Country (All countries), Elevation (Any elevation) and Mountain range'
		);
	});
});

describe('removed bands notice', () => {
	it('names the bands that were let go while elevation stayed', () => {
		expect(autoResetNotice([], m(4000))).toBe(
			'Elevation band 4,000–4,999 m removed: no mountains matched with your choice.'
		);
		expect(autoResetNotice([], m(3000, 4000))).toBe(
			'Elevation bands 3,000–3,999 m, 4,000–4,999 m removed: no mountains matched with your choice.'
		);
	});

	it('names bands in the unit they were chosen in', () => {
		expect(autoResetNotice([], ft(29_000))).toBe(
			'Elevation band 29,000–29,999 ft removed: no mountains matched with your choice.'
		);
	});
});

describe('elevation band labels', () => {
	it('shows whole numbers with both ends included, in the band’s own unit', () => {
		expect(elevationBandLabel(4000, 'metric')).toBe('4,000–4,999 m');
		expect(elevationBandLabel(0, 'imperial')).toBe('0–999 ft');
		expect(elevationBandLabel(14_000, 'imperial')).toBe('14,000–14,999 ft');
	});

	it('places a kept band approximately in the displayed unit', () => {
		expect(convertedBandLabel(4000, 'metric', 'imperial')).toBe('about 13,123–16,404 ft');
		expect(convertedBandLabel(7000, 'imperial', 'metric')).toBe('about 2,134–2,438 m');
	});

	it('says which bands a choice in the displayed unit replaced', () => {
		expect(retainedBandsReplacedNotice('metric', 'imperial')).toBe(
			'Elevation bands in meters replaced by your choice in feet.'
		);
	});
});

describe('elevationSummary', () => {
	it('says any, the one band, or how many', () => {
		expect(elevationSummary(null, 'metric')).toBe('Any elevation');
		expect(elevationSummary(m(4000), 'metric')).toBe('4,000–4,999 m');
		expect(elevationSummary(m(3000, 5000), 'metric')).toBe('2 elevation bands');
		expect(elevationSummary(ft(3000, 4000, 5000), 'imperial')).toBe('3 elevation bands');
	});

	it('names the unit of bands kept from the other system', () => {
		expect(elevationSummary(m(4000), 'imperial')).toBe('4,000–4,999 m');
		expect(elevationSummary(m(3000, 5000), 'imperial')).toBe('2 bands in meters');
		expect(elevationSummary(ft(9000, 29_000), 'metric')).toBe('2 bands in feet');
	});
});

describe('search copy', () => {
	it('quotes what was searched for', () => {
		expect(noCountriesMessage('xyz')).toBe('No countries match \u201cxyz\u201d.');
		expect(noRangesMessage('xyz')).toBe('No mountain ranges match \u201cxyz\u201d.');
	});

	it('counts the results of a search', () => {
		expect(choicesFound(1)).toBe('1 result');
		expect(choicesFound(12)).toBe('12 results');
	});
});
