import { describe, expect, it } from 'vitest';
import { isIntentionalClick } from './chooserClick';

describe('chooser link clicks', () => {
	it('ignores a pointer click whose press began before the chooser, as the opening tap does', () => {
		expect(isIntentionalClick({ detail: 1 }, false)).toBe(false);
	});

	it('follows a pointer click whose press began inside the chooser, for a mouse or a finger', () => {
		expect(isIntentionalClick({ detail: 1 }, true)).toBe(true);
		expect(isIntentionalClick({ detail: 2 }, true)).toBe(true);
	});

	it('follows a click with no pointer behind it, such as Enter or assistive technology', () => {
		expect(isIntentionalClick({ detail: 0 }, false)).toBe(true);
	});
});
