import { describe, expect, it } from 'vitest';
import { indexEntry } from '../api/test-support/indexEntries';
import { groupByContinent } from './groupByContinent';

const EUROPE = { code: 'EU', name: 'Europe' };
const ASIA = { code: 'AS', name: 'Asia' };

describe('groupByContinent', () => {
	it('orders continents and their mountains by name, whatever the index order', () => {
		const groups = groupByContinent([
			indexEntry('mont-blanc', 'Mont Blanc', { continent: EUROPE }),
			indexEntry('everest', 'Mount Everest', { continent: ASIA }),
			indexEntry('eiger', 'Eiger', { continent: EUROPE }),
			indexEntry('ama-dablam', 'Ama Dablam', { continent: ASIA })
		]);

		expect(groups.map(({ name, mountains }) => [name, mountains.map((m) => m.slug)])).toEqual([
			['Asia', ['ama-dablam', 'everest']],
			['Europe', ['eiger', 'mont-blanc']]
		]);
	});

	it('ignores accents and case, and breaks name ties by slug', () => {
		const groups = groupByContinent([
			indexEntry('monch-2', 'Mönch'),
			indexEntry('monch-1', 'MONCH'),
			indexEntry('matterhorn', 'matterhorn')
		]);

		expect(groups[0]?.mountains.map((m) => m.slug)).toEqual(['matterhorn', 'monch-1', 'monch-2']);
	});

	it('keeps every mountain exactly once', () => {
		const entries = Array.from({ length: 75 }, (_, i) =>
			indexEntry(`m-${i}`, `Mountain ${i}`, { continent: i % 2 ? EUROPE : ASIA })
		);

		expect(groupByContinent(entries).flatMap((g) => g.mountains)).toHaveLength(75);
		expect(groupByContinent([])).toEqual([]);
	});
});
