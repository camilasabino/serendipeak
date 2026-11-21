import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ContourMotif } from './ContourMotif';
import {
	ABOUT_CONTOURS,
	CLOSING_CONTOURS,
	ERROR_CONTOURS,
	LOADING_CONTOURS
} from './contourPatterns';

const pathsOf = (html: string) => html.match(/<path\s/g)?.length ?? 0;

describe('ContourMotif', () => {
	const html = renderToStaticMarkup(<ContourMotif pattern={ABOUT_CONTOURS} />);

	it('stays decorative: hidden from assistive technology, unfocusable and unlabelled', () => {
		expect(html).toContain('aria-hidden="true"');
		expect(html).toContain('focusable="false"');
		expect(html).not.toMatch(/<title|<desc|aria-label|role=|tabindex/);
		expect(html).not.toMatch(/<(a|button|image|text)\b/);
	});

	it('draws one closed path per ring inside the pattern viewBox', () => {
		expect(html).toContain('viewBox="0 0 552 220"');
		expect(pathsOf(html)).toBe(ABOUT_CONTOURS.rings.length);
		for (const { d } of ABOUT_CONTOURS.rings) {
			expect(d).toMatch(/^M[\d. -]+(C[\d. -]+)+Z$/);
		}
	});

	it('anchors to the upper right and crops, so the summit rings survive a narrow box', () => {
		expect(html).toContain('preserveAspectRatio="xMaxYMin slice"');
	});

	it('centres a pattern drawn around its middle when asked to', () => {
		const centred = renderToStaticMarkup(
			<ContourMotif pattern={LOADING_CONTOURS} align="center" />
		);

		expect(centred).toContain('preserveAspectRatio="xMidYMid slice"');
	});

	it('animates only when asked: reveal adds a trace per ring, ordered from the innermost outward', () => {
		const still = renderToStaticMarkup(<ContourMotif pattern={LOADING_CONTOURS} />);
		const revealed = renderToStaticMarkup(<ContourMotif pattern={LOADING_CONTOURS} reveal />);
		const rings = LOADING_CONTOURS.rings.length;
		const order = Array.from({ length: rings }, (_, position) => `--ring:${rings - 1 - position}`);

		expect(still).not.toMatch(/--ring|pathLength/);
		expect(pathsOf(revealed)).toBe(rings * 2);
		expect(revealed.match(/pathLength="1"/g)).toHaveLength(rings);
		expect(revealed.match(/--ring:\d+/g)).toEqual(order.flatMap((ring) => [ring, ring]));
		expect(revealed).not.toMatch(/<(animate|set|style)\b/);
	});

	it.each([
		['loading', LOADING_CONTOURS, 552, 230, 4],
		['error', ERROR_CONTOURS, 552, 190, 7],
		['closing', CLOSING_CONTOURS, 552, 150, 7]
	])('ships the %s pattern as fixed, well-formed rings', (_name, pattern, width, height, rings) => {
		expect(pattern.width).toBe(width);
		expect(pattern.height).toBe(height);
		expect(pattern.rings).toHaveLength(rings);
		for (const { d } of pattern.rings) {
			expect(d).toMatch(/^M[\d. -]+(C[\d. -]+)+Z$/);
		}
		expect(new Set(pattern.rings.map(({ d }) => d)).size).toBe(rings);
	});

	it('marks index contours only at the index level', () => {
		const quiet = renderToStaticMarkup(<ContourMotif pattern={ABOUT_CONTOURS} level="quiet" />);
		const index = renderToStaticMarkup(<ContourMotif pattern={ABOUT_CONTOURS} level="index" />);
		const indexRings = ABOUT_CONTOURS.rings.filter(({ index: isIndex }) => isIndex).length;

		expect(indexRings).toBeGreaterThan(0);
		expect(quiet).not.toMatch(/<path[^>]*class=/);
		expect(index.match(/<path[^>]*class=/g)).toHaveLength(indexRings);
	});

	it('merges the caller class with its own', () => {
		const withClass = renderToStaticMarkup(
			<ContourMotif pattern={ABOUT_CONTOURS} className="slot" />
		);

		expect(withClass).toMatch(/class="[^"]*\bslot\b/);
	});

	it('keeps path data fixed: the same markup on every render', () => {
		expect(renderToStaticMarkup(<ContourMotif pattern={ABOUT_CONTOURS} />)).toBe(html);
	});
});
