import { describe, expect, it } from 'vitest';
import { describeEntry, placeOf } from './describeEntry';
import { indexEntry } from '../api/test-support/indexEntries';

const region = {
	slug: 'cordillera-blanca',
	name: 'Cordillera Blanca',
	ancestors: [{ slug: 'andes', name: 'Andes' }]
};

describe('placeOf', () => {
	it('names the countries when there are any', () => {
		const entry = indexEntry('border-spire', 'Border Spire', {
			countries: [
				{ code: 'CN', name: 'China' },
				{ code: 'NP', name: 'Nepal' }
			],
			region
		});

		expect(placeOf(entry)).toBe('China and Nepal');
	});

	it('names the region and its parent without countries', () => {
		expect(placeOf(indexEntry('a', 'A', { countries: [], region }))).toBe(
			'Cordillera Blanca, Andes'
		);
	});

	it('names the continent without countries or region', () => {
		expect(placeOf(indexEntry('a', 'A', { countries: [], region: null }))).toBe('Europe');
	});
});

describe('describeEntry', () => {
	it('joins the place and the formatted elevation', () => {
		expect(describeEntry(indexEntry('a', 'A', { elevationMeters: 6961 }))).toBe(
			'Switzerland · 6,961 m'
		);
	});
});
