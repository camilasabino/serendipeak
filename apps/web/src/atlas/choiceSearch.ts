import { foldName } from '../search/foldName';

/** One choice of a filter: what it is called, how many mountains it would leave, and where it sits. */
export interface ChoiceOption {
	value: string;
	label: string;
	count: number;
	/** Levels above it in a tree of choices, for indenting; 0 for a flat list. */
	depth: number;
	/** The names above it, root first; empty for a flat list. */
	trail: readonly string[];
}

// Lower ranks are listed first.
const NAME_START = 0;
const WORD_START = 1;
const INSIDE = 2;

/**
 * The choices whose name contains the query, ignoring case, accents and punctuation: names that
 * start with it first, then names with a word that starts with it, then any other match, each group
 * in the order given. An empty query keeps every choice, as given.
 */
export function searchChoices(
	options: readonly ChoiceOption[],
	query: string
): readonly ChoiceOption[] {
	const needle = foldName(query);
	if (needle === '') {
		return options;
	}

	const ranked: { option: ChoiceOption; rank: number }[] = [];
	for (const option of options) {
		const folded = foldName(option.label);
		const at = folded.indexOf(needle);
		if (at === -1) {
			continue;
		}
		ranked.push({
			option,
			rank: at === 0 ? NAME_START : folded.includes(` ${needle}`) ? WORD_START : INSIDE
		});
	}

	// Array.prototype.sort is stable, so equal ranks keep the order of the options.
	return ranked.sort((a, b) => a.rank - b.rank).map(({ option }) => option);
}
