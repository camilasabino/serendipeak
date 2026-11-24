import { describe, expect, it } from 'vitest';
import { searchChoices, type ChoiceOption } from './choiceSearch';

function choice(label: string, trail: string[] = []): ChoiceOption {
	return { value: label.toLowerCase(), label, count: 1, depth: trail.length, trail };
}

const COUNTRIES = [choice('Argentina'), choice('Chile'), choice('Côte d’Ivoire'), choice('Nepal')];

const labels = (options: readonly ChoiceOption[]) => options.map(({ label }) => label);

describe('searchChoices', () => {
	it('keeps every choice, as given, for an empty or blank query', () => {
		expect(searchChoices(COUNTRIES, '')).toBe(COUNTRIES);
		expect(searchChoices(COUNTRIES, '   ')).toBe(COUNTRIES);
	});

	it('ignores case', () => {
		expect(labels(searchChoices(COUNTRIES, 'CHILE'))).toEqual(['Chile']);
	});

	it('ignores accents and punctuation in either side', () => {
		expect(labels(searchChoices(COUNTRIES, 'cote divoire'))).toEqual(['Côte d’Ivoire']);
		expect(labels(searchChoices(COUNTRIES, 'Côte d’Ivoire'))).toEqual(['Côte d’Ivoire']);
	});

	it('finds a name by any part of it', () => {
		expect(labels(searchChoices(COUNTRIES, 'tin'))).toEqual(['Argentina']);
	});

	it('lists names that start with the query, then word starts, then the rest', () => {
		const ranges = [choice('Pre-Alps'), choice('Eastern Alps'), choice('Alps'), choice('Palpable')];

		expect(labels(searchChoices(ranges, 'alp'))).toEqual([
			'Alps',
			'Pre-Alps',
			'Eastern Alps',
			'Palpable'
		]);
	});

	it('keeps the order given within a rank', () => {
		const ranges = [choice('Alpha'), choice('Alpine'), choice('Alps')];

		expect(labels(searchChoices(ranges, 'alp'))).toEqual(['Alpha', 'Alpine', 'Alps']);
	});

	it('returns nothing when no name matches', () => {
		expect(searchChoices(COUNTRIES, 'zzz')).toEqual([]);
	});

	it('matches the name of a nested choice, not the names above it', () => {
		const ranges = [choice('Alps'), choice('Dolomites', ['Alps'])];

		expect(labels(searchChoices(ranges, 'alps'))).toEqual(['Alps']);
		expect(searchChoices(ranges, 'dolo')[0]?.trail).toEqual(['Alps']);
	});
});
