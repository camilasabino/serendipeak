import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { scaleSpecForStage, WRAPPED_CREDITS_STAGE_PX } from '../globe/scaleBar';
import { ScaleBar } from './ScaleBar';

const render = (reading: Parameters<typeof ScaleBar>[0]['reading']) =>
	renderToStaticMarkup(<ScaleBar reading={reading} />);

describe('ScaleBar', () => {
	it('renders the existing reading label and a bar as wide as the reading', () => {
		const html = render({ label: '2 km', meters: 2000, widthPx: 96.4 });

		expect(html).toContain('2 km');
		expect(html).toContain('width="96"');
		expect(html).toContain('viewBox="0 0 96 8"');
	});

	it('names the label for assistive technology and hides the drawing', () => {
		const html = render({ label: '500 m', meters: 500, widthPx: 80 });

		expect(html).toMatch(/Scale:<\/span> 500 m/);
		expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
	});

	it('keeps a drawable bar for a very short reading', () => {
		expect(render({ label: '1 m', meters: 1, widthPx: 0.2 })).toContain('width="2"');
	});

	it('renders nothing, and no placeholder, while the scale is unavailable', () => {
		expect(render(undefined)).toBe('');
	});

	it('is drawn where the view is sampled', () => {
		const wide = scaleSpecForStage(WRAPPED_CREDITS_STAGE_PX);
		const narrow = scaleSpecForStage(WRAPPED_CREDITS_STAGE_PX - 1);
		const html = render({ label: '2 km', meters: 2000, widthPx: 96 });

		expect(html).toContain(`--scale-inset:${wide.insetPx}px`);
		expect(html).toContain(`--scale-bottom:${wide.bottomPx}px`);
		expect(html).toContain(`--scale-bottom-narrow:${narrow.bottomPx}px`);
	});

	it('switches to the narrow offset at the same stage width the sampler uses', () => {
		const css = readFileSync(new URL('./ScaleBar.module.css', import.meta.url), 'utf8');

		expect(css).toContain(`@container (max-width: ${WRAPPED_CREDITS_STAGE_PX - 0.02}px)`);
	});
});
