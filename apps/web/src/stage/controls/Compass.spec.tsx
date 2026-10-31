import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Compass } from './Compass';

const render = (headingDegrees: number | undefined) =>
	renderToStaticMarkup(<Compass headingDegrees={headingDegrees} />);

describe('Compass', () => {
	it('speaks the integer heading and the eight-point direction', () => {
		expect(render(0)).toContain('Compass. Looking 0 degrees north.');
		expect(render(42)).toContain('Compass. Looking 42 degrees northeast.');
		expect(render(270)).toContain('Compass. Looking 270 degrees west.');
	});

	it('shows the bearing as a visual readout hidden from assistive technology', () => {
		const html = render(135);

		expect(html).toMatch(/<p[^>]*aria-hidden="true"[^>]*>135° · SE<\/p>/);
	});

	it('turns the rose against the heading so north stays where the world is', () => {
		expect(render(90)).toContain('rotate(-90deg)');
		expect(render(0)).toContain('rotate(0deg)');
	});

	it('hides the decorative rose from assistive technology', () => {
		expect(render(10)).toMatch(/<svg[^>]*aria-hidden="true"/);
	});

	it('is not interactive', () => {
		const html = render(10);

		expect(html).not.toMatch(/<(button|a|input)[\s>]/);
		expect(html).not.toMatch(/tabindex|onclick|role="button"/i);
	});

	it.each([undefined, Number.NaN])('renders nothing for an unavailable heading (%s)', (heading) => {
		expect(render(heading)).toBe('');
	});
});
