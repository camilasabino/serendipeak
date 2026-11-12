import { describe, expect, it } from 'vitest';
import { findMountains, prepareIndex } from './findMountains';
import { indexEntry } from './test-support/indexEntries';

const index = prepareIndex([
	indexEntry('mount-olympus', 'Mount Olympus'),
	indexEntry('olympus-mons', 'Olympus Mons'),
	indexEntry('monch', 'Mönch'),
	indexEntry('aconcagua', 'Aconcagua'),
	indexEntry('nevado-huascaran', 'Nevado Huascarán'),
	indexEntry('mont-blanc', 'Mont Blanc'),
	indexEntry('mont-blanc-du-tacul', 'Mont Blanc du Tacul'),
	indexEntry('pic-daneto', 'Pic d’Aneto')
]);

const slugsFor = (query: string) => findMountains(index, query).map((entry) => entry.slug);

describe('findMountains', () => {
	it('matches nothing for an empty or blank query', () => {
		expect(slugsFor('')).toEqual([]);
		expect(slugsFor('   ')).toEqual([]);
		expect(slugsFor('—')).toEqual([]);
	});

	it('ignores case and accents in both the query and the name', () => {
		expect(slugsFor('MONCH')).toEqual(['monch']);
		expect(slugsFor('huascaran')).toEqual(['nevado-huascaran']);
		expect(slugsFor('Huascarán')).toEqual(['nevado-huascaran']);
		expect(slugsFor('mönch')).toEqual(['monch']);
	});

	it('matches part of a name, anywhere in it', () => {
		expect(slugsFor('cagu')).toEqual(['aconcagua']);
		expect(slugsFor('aneto')).toEqual(['pic-daneto']);
	});

	it('lists names that start with the query, then word starts, then other matches', () => {
		expect(slugsFor('olymp')).toEqual(['olympus-mons', 'mount-olympus']);
		expect(slugsFor('mon')).toEqual(['monch', 'mont-blanc', 'mont-blanc-du-tacul', 'olympus-mons']);
		expect(slugsFor('o')).toEqual([
			'olympus-mons',
			'mount-olympus',
			'aconcagua',
			'monch',
			'mont-blanc',
			'mont-blanc-du-tacul',
			'nevado-huascaran',
			'pic-daneto'
		]);
	});

	it('matches across words and punctuation', () => {
		expect(slugsFor('mont blanc')).toEqual(['mont-blanc', 'mont-blanc-du-tacul']);
		expect(slugsFor('mont-blanc du')).toEqual(['mont-blanc-du-tacul']);
		expect(slugsFor("pic d'aneto")).toEqual(['pic-daneto']);
	});

	it('finds nothing for a name that no mountain has', () => {
		expect(slugsFor('kilimanjaro')).toEqual([]);
	});

	it('orders equally ranked names deterministically, by name then slug', () => {
		const twins = prepareIndex([
			indexEntry('twin-peak-b', 'Twin Peak'),
			indexEntry('twin-peak-a', 'Twin Peak')
		]);

		expect(findMountains(twins, 'twin').map((entry) => entry.slug)).toEqual([
			'twin-peak-a',
			'twin-peak-b'
		]);
	});

	it('returns the entries themselves, unchanged', () => {
		const [entry] = findMountains(index, 'aconcagua');

		expect(entry).toBe(index.find((mountain) => mountain.entry.slug === 'aconcagua')?.entry);
	});
});
