import { describe, expect, it } from 'vitest';
import { InvalidPublicConfigError, readCesiumConfig, readPublicConfig } from './readPublicConfig';

describe('readPublicConfig', () => {
	it('reads the API base URL', () => {
		expect(readPublicConfig({ NEXT_PUBLIC_API_BASE_URL: 'http://localhost:8000' })).toEqual({
			apiBaseUrl: 'http://localhost:8000'
		});
	});

	it('strips trailing slashes from the API base URL', () => {
		const config = readPublicConfig({ NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test//' });

		expect(config.apiBaseUrl).toBe('https://api.example.test');
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

describe('readCesiumConfig', () => {
	it('reads the ion token and the imagery mode without requiring the API base URL', () => {
		expect(
			readCesiumConfig({
				NEXT_PUBLIC_CESIUM_ION_TOKEN: ' token ',
				NEXT_PUBLIC_CESIUM_IMAGERY_MODE: 'none'
			})
		).toEqual({ ionToken: 'token', imageryMode: 'none' });
	});

	it.each([undefined, '', '   '])('treats %j as unset', (value) => {
		expect(
			readCesiumConfig({
				NEXT_PUBLIC_CESIUM_ION_TOKEN: value,
				NEXT_PUBLIC_CESIUM_IMAGERY_MODE: value
			})
		).toEqual({ ionToken: null, imageryMode: null });
	});

	it('leaves the imagery mode unvalidated for the imagery policy to resolve', () => {
		expect(readCesiumConfig({ NEXT_PUBLIC_CESIUM_IMAGERY_MODE: 'satellite' }).imageryMode).toBe(
			'satellite'
		);
	});
});
