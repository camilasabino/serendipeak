import { describe, expect, it } from 'vitest';
import {
	autoResetNotice,
	choicesFound,
	elevationSummary,
	noCountriesMessage,
	noRangesMessage
} from './atlasCopy';

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
		expect(autoResetNotice([], [4000])).toBe(
			'Elevation band 4,000–4,999 m removed: no mountains matched with your choice.'
		);
		expect(autoResetNotice([], [3000, 4000])).toBe(
			'Elevation bands 3,000–3,999 m, 4,000–4,999 m removed: no mountains matched with your choice.'
		);
	});
});

describe('elevationSummary', () => {
	it('says any, the one band, or how many', () => {
		expect(elevationSummary([], 1000)).toBe('Any elevation');
		expect(elevationSummary([4000], 1000)).toBe('4,000–4,999 m');
		expect(elevationSummary([3000, 5000], 1000)).toBe('2 elevation bands');
		expect(elevationSummary([3000, 4000, 5000], 1000)).toBe('3 elevation bands');
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
