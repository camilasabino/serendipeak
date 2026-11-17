import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandMark } from './BrandMark';

const ringsOf = (html: string) => html.match(/<path\s/g)?.length ?? 0;

describe('BrandMark', () => {
	it('stays decorative, so the surrounding link or status names it', () => {
		const html = renderToStaticMarkup(<BrandMark size={32} />);

		expect(html).toContain('aria-hidden="true"');
		expect(html).not.toMatch(/<title|aria-label|role=/);
	});

	it('renders at the requested size', () => {
		const html = renderToStaticMarkup(<BrandMark size={64} />);

		expect(html).toContain('width="64"');
		expect(html).toContain('height="64"');
	});

	it('draws three rings from the header size up and two heavier rings at small sizes', () => {
		expect(ringsOf(renderToStaticMarkup(<BrandMark size={32} />))).toBe(3);
		expect(ringsOf(renderToStaticMarkup(<BrandMark size={64} />))).toBe(3);
		expect(ringsOf(renderToStaticMarkup(<BrandMark size={24} />))).toBe(2);
		expect(ringsOf(renderToStaticMarkup(<BrandMark size={16} />))).toBe(2);
	});

	it('marks the summit once', () => {
		expect(renderToStaticMarkup(<BrandMark size={32} />).match(/<circle\s/g)).toHaveLength(1);
	});
});
