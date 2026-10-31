import { describe, expect, it } from 'vitest';
import { anchorsOf, countOf, hasEmptyElement, textsOf } from './markup';

describe('markup helpers', () => {
	it('detects empty elements outside graphics only', () => {
		expect(hasEmptyElement('<div><p></p></div>')).toBe(true);
		expect(hasEmptyElement('<div><p>  </p></div>')).toBe(true);
		expect(hasEmptyElement('<div><p>text</p><svg><path d="M0"></path></svg></div>')).toBe(false);
	});

	it('counts whole tag names only', () => {
		expect(countOf('<h1 id="a">x</h1><header>', 'h1')).toBe(1);
		expect(countOf('<h1>x</h1><h2>y</h2>', 'h[2-6]')).toBe(1);
	});

	it('reads texts and anchors with entities decoded', () => {
		expect(textsOf('<dt>A &amp; B</dt><dt><b>C</b></dt>', 'dt')).toEqual(['A & B', 'C']);
		expect(anchorsOf('<a href="/x?a=1&amp;b=2" target="_blank">go</a>')).toEqual([
			{ href: '/x?a=1&b=2', text: 'go', attributes: 'href="/x?a=1&amp;b=2" target="_blank"' }
		]);
	});
});
