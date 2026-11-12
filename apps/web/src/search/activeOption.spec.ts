import { describe, expect, it } from 'vitest';
import { moveActiveOption } from './activeOption';

describe('moveActiveOption', () => {
	it('starts at the first option going down and at the last going up', () => {
		expect(moveActiveOption(-1, 3, 'ArrowDown')).toBe(0);
		expect(moveActiveOption(-1, 3, 'ArrowUp')).toBe(2);
	});

	it('moves one option at a time and wraps at both ends', () => {
		expect(moveActiveOption(0, 3, 'ArrowDown')).toBe(1);
		expect(moveActiveOption(2, 3, 'ArrowDown')).toBe(0);
		expect(moveActiveOption(1, 3, 'ArrowUp')).toBe(0);
		expect(moveActiveOption(0, 3, 'ArrowUp')).toBe(2);
	});

	it('has no active option without options', () => {
		expect(moveActiveOption(-1, 0, 'ArrowDown')).toBe(-1);
		expect(moveActiveOption(2, 0, 'ArrowUp')).toBe(-1);
	});
});
