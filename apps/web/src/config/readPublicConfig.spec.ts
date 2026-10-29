import { describe, expect, it } from 'vitest';
import { InvalidPublicConfigError, readPublicConfig } from './readPublicConfig';

describe('readPublicConfig', () => {
	it('reads the API base URL and the ion token', () => {
		expect(
			readPublicConfig({
				NEXT_PUBLIC_API_BASE_URL: 'http://localhost:8000',
				NEXT_PUBLIC_CESIUM_ION_TOKEN: 'token'
			})
		).toEqual({ apiBaseUrl: 'http://localhost:8000', cesiumIonToken: 'token' });
	});

	it('strips trailing slashes from the API base URL', () => {
		const config = readPublicConfig({ NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test//' });

		expect(config.apiBaseUrl).toBe('https://api.example.test');
	});

	it.each([undefined, '', '   '])('treats %j as a missing ion token', (token) => {
		const config = readPublicConfig({
			NEXT_PUBLIC_API_BASE_URL: 'http://localhost:8000',
			NEXT_PUBLIC_CESIUM_ION_TOKEN: token
		});

		expect(config.cesiumIonToken).toBeNull();
	});

	it.each([undefined, '', '  ', 'not a url', 'ftp://localhost'])(
		'rejects API base URL %j',
		(value) => {
			expect(() => readPublicConfig({ NEXT_PUBLIC_API_BASE_URL: value })).toThrow(
				InvalidPublicConfigError
			);
		}
	);
});
