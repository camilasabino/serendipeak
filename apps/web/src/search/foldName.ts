// Letters that Unicode decomposition keeps whole, so "Bjørn" is found by "bjorn".
const UNDECOMPOSED: Readonly<Record<string, string>> = {
	ø: 'o',
	æ: 'ae',
	œ: 'oe',
	ß: 'ss',
	ł: 'l',
	đ: 'd',
	ð: 'd',
	þ: 'th',
	ı: 'i'
};
const UNDECOMPOSED_LETTER = /[øæœßłđðþı]/g;
const APOSTROPHES = /['’ʻ`]/g;
const SEPARATORS = /[^\p{L}\p{N}]+/gu;

/** Case-, accent- and punctuation-insensitive form of a name, with words separated by one space. */
export function foldName(text: string): string {
	return text
		.toLowerCase()
		.normalize('NFKD')
		.replace(/\p{M}+/gu, '')
		.replace(UNDECOMPOSED_LETTER, (letter) => UNDECOMPOSED[letter] ?? letter)
		.replace(APOSTROPHES, '')
		.replace(SEPARATORS, ' ')
		.trim();
}
