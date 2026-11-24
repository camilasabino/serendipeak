import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { anchorsOf } from '../mountain-page/test-support/markup';
import { TestExperience } from '../test/TestExperience';
import { SiteHeader } from './SiteHeader';

function render(pathname?: string): string {
	return renderToStaticMarkup(
		<TestExperience>
			<SiteHeader pathname={pathname} />
		</TestExperience>
	);
}

const navOf = (html: string) => /<nav[\s\S]*<\/nav>/.exec(html)?.[0] ?? '';

describe('SiteHeader menu', () => {
	it('offers the menu as a closed disclosure that controls the panel holding the destinations', () => {
		const nav = navOf(render());
		const toggle = /<button[^>]*aria-controls="([^"]+)"[^>]*>/.exec(nav);
		const panelId = toggle?.[1];

		expect(toggle?.[0]).toContain('aria-expanded="false"');
		expect(toggle?.[0]).not.toContain('aria-haspopup');
		expect(nav).toMatch(/<span>Menu<\/span><\/button>/);
		expect(nav).toMatch(new RegExp(`<div[^>]*id="${panelId}"`));
		expect(nav).not.toMatch(/<div[^>]*id="[^"]+"[^>]*data-open/);
	});

	it('keeps search first, then the menu button, then the panel, so Tab follows the visual order', () => {
		const nav = navOf(render());
		const order = [
			'aria-haspopup="dialog"',
			'aria-expanded',
			'>Today<',
			'>Atlas<',
			'>About<',
			'role="group"'
		].map((marker) => nav.indexOf(marker));

		expect(order.every((index) => index >= 0)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it('puts the three destinations and the unit selector inside the panel, in the primary navigation', () => {
		const html = render();
		const panel =
			/<div[^>]*id="[^"]+"[^>]*class="[^"]*panel[^"]*"[\s\S]*<\/nav>/.exec(html)?.[0] ?? '';

		expect(html).toContain('aria-label="Primary"');
		expect(anchorsOf(navOf(html)).map(({ text }) => text)).toEqual(['Today', 'Atlas', 'About']);
		expect(panel).toContain('role="group" aria-label="Units"');
		expect(panel).toContain('aria-pressed="true"');
	});

	it('names the unit selector once to assistive technology, hiding the visible label', () => {
		const html = render();

		expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>Units<\/span>/);
		expect(html.match(/aria-label="Units"/g)).toHaveLength(1);
	});

	it.each([
		['/', 'Today'],
		['/atlas', 'Atlas'],
		['/about', 'About']
	])('marks only %s as the current page', (pathname, label) => {
		const current = [
			...navOf(render(pathname)).matchAll(/<a[^>]*aria-current="page"[^>]*>([^<]*)<\/a>/g)
		];

		expect(current.map((match) => match[1])).toEqual([label]);
	});

	it('leaves the brand link to carry the home label with decorative artwork', () => {
		const html = render();

		expect(html).toMatch(/<a[^>]*aria-label="SerendiPeak home"/);
		expect(html.match(/<img[^>]*alt=""/g)).toHaveLength(2);
	});
});
