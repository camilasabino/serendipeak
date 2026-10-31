import { describe, it, expect } from 'vitest';
import { MissingIonTokenError, requireIonToken } from './ionToken';

describe('requireIonToken', () => {
	it('returns a configured token', () => {
		expect(requireIonToken('abc.def')).toBe('abc.def');
	});

	it('trims surrounding whitespace', () => {
		expect(requireIonToken('  abc.def \n')).toBe('abc.def');
	});

	it.each([undefined, '', '   '])('rejects the missing value %j', (value) => {
		expect(() => requireIonToken(value)).toThrow(MissingIonTokenError);
	});

	it('names the missing variable in the error message', () => {
		const error = new MissingIonTokenError();

		expect(error.message).toContain('PUBLIC_CESIUM_ION_TOKEN');
	});
});
