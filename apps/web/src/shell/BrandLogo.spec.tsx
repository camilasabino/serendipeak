import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BrandSymbol, BrandWordmark, SYMBOL_PATH, WORDMARK_PATH } from './BrandLogo';

describe('BrandLogo', () => {
	it('stays decorative, so the surrounding link or status names it', () => {
		for (const html of [
			renderToStaticMarkup(<BrandWordmark />),
			renderToStaticMarkup(<BrandSymbol />)
		]) {
			expect(html).toContain('alt=""');
			expect(html).not.toMatch(/aria-label|role=|<title/);
		}
	});

	it('points at the approved static artwork', () => {
		expect(renderToStaticMarkup(<BrandWordmark />)).toContain(`src="${WORDMARK_PATH}"`);
		expect(renderToStaticMarkup(<BrandSymbol />)).toContain(`src="${SYMBOL_PATH}"`);
	});

	it("declares the artwork's intrinsic size so the page reserves its space", () => {
		expect(renderToStaticMarkup(<BrandWordmark />)).toMatch(/width="1562"[^>]*height="275"/);
		expect(renderToStaticMarkup(<BrandSymbol />)).toMatch(/width="880"[^>]*height="753"/);
	});

	it('passes the host class through', () => {
		expect(renderToStaticMarkup(<BrandSymbol className="host" />)).toContain('class="host"');
	});
});
