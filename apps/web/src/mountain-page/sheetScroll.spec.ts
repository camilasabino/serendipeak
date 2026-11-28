import { describe, expect, it } from 'vitest';
import { scrollToTop } from './sheetScroll';

describe('scrollToTop', () => {
	it('brings a scrolled sheet back to its top', () => {
		const sheet = { scrollTop: 480 };

		expect(scrollToTop(sheet)).toBe(true);
		expect(sheet.scrollTop).toBe(0);
	});

	it('leaves a sheet already at its top alone', () => {
		const sheet = { scrollTop: 0 };

		expect(scrollToTop(sheet)).toBe(false);
		expect(sheet.scrollTop).toBe(0);
	});

	it('does nothing without a sheet', () => {
		expect(scrollToTop(null)).toBe(false);
	});
});
