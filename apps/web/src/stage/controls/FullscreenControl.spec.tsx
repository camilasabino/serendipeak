import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { FullscreenControl } from './FullscreenControl';

describe('FullscreenControl', () => {
	it('is a native button named for the action it performs', () => {
		const enter = renderToStaticMarkup(<FullscreenControl active={false} onToggle={() => {}} />);
		const exit = renderToStaticMarkup(<FullscreenControl active onToggle={() => {}} />);

		expect(enter).toMatch(/^<button type="button"/);
		expect(enter).toContain('Enter fullscreen</span>');
		expect(exit).toContain('Exit fullscreen</span>');
		for (const html of [enter, exit]) {
			expect(html).not.toContain('role=');
			expect(html).not.toContain('tabindex');
			expect(html).not.toContain('aria-pressed');
			expect(html).not.toMatch(/\sdisabled/);
		}
	});

	it('hides the decorative icon from assistive technology', () => {
		const html = renderToStaticMarkup(<FullscreenControl active={false} onToggle={() => {}} />);

		expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
	});

	it('draws a different icon for entering and leaving', () => {
		const icon = (active: boolean) =>
			renderToStaticMarkup(<FullscreenControl active={active} onToggle={() => {}} />).match(
				/<path d="([^"]+)"/
			)?.[1];

		expect(icon(false)).toBeDefined();
		expect(icon(false)).not.toBe(icon(true));
	});

	it('runs the toggle command once per activation', () => {
		const onToggle = vi.fn();
		const element = FullscreenControl({ active: false, onToggle });
		const { onClick } = (element as unknown as { props: { onClick: () => void } }).props;
		onClick();

		expect(onToggle).toHaveBeenCalledTimes(1);
	});
});
