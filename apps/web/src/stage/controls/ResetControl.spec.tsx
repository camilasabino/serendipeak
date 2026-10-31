import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ResetControl } from './ResetControl';

describe('ResetControl', () => {
	it('is a native button named "Reset view" that submits nothing', () => {
		const html = renderToStaticMarkup(<ResetControl enabled onReset={() => {}} />);

		expect(html).toMatch(/^<button type="button"/);
		expect(html).toContain('Reset view</span>');
		expect(html).not.toContain('role=');
		expect(html).not.toContain('tabindex');
	});

	it('exposes the disabled state natively when Reset is not available', () => {
		const html = renderToStaticMarkup(<ResetControl enabled={false} onReset={() => {}} />);

		expect(html).toMatch(/<button[^>]*\sdisabled(=""|\s|>)/);
	});

	it('is enabled when Reset is available', () => {
		const html = renderToStaticMarkup(<ResetControl enabled onReset={() => {}} />);

		expect(html).not.toMatch(/\sdisabled/);
	});

	it('hides the decorative icon from assistive technology', () => {
		const html = renderToStaticMarkup(<ResetControl enabled onReset={() => {}} />);

		expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
	});

	it('runs the reset command once per activation', () => {
		const onReset = vi.fn();
		const element = ResetControl({ enabled: true, onReset });

		expect(isValidElement<{ onClick: () => void }>(element)).toBe(true);
		const { onClick } = (element as { props: { onClick: () => void } }).props;
		onClick();
		onClick();

		expect(onReset).toHaveBeenCalledTimes(2);
	});
});
