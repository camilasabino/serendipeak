import { describe, expect, it } from 'vitest';
import { foldName } from './foldName';

describe('foldName', () => {
	it.each([
		['Mönch', 'monch'],
		['NEVADO HUASCARÁN', 'nevado huascaran'],
		['Pic d’Aneto', 'pic daneto'],
		["K'gari", 'kgari'],
		['Mont-Blanc', 'mont blanc'],
		['  Mount   Fuji  ', 'mount fuji'],
		['Snøhetta', 'snohetta'],
		['Łomnica', 'lomnica'],
		['Großglockner', 'grossglockner'],
		['İstanbul', 'istanbul'],
		['Ararat (Ağrı Dağı)', 'ararat agri dagi'],
		['Ｆｕｊｉ', 'fuji'],
		['--', '']
	])('folds %j to %j', (text, folded) => {
		expect(foldName(text)).toBe(folded);
	});
});
