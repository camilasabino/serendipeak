import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvalidPublicConfigError } from '../config/readPublicConfig';
import { HttpMountainApi } from './HttpMountainApi';
import { createServerMountainApi } from './serverMountainApi';

describe('createServerMountainApi', () => {
	afterEach(() => {
		vi.unstubAllEnvs();
	});

	it('builds an HTTP API from NEXT_PUBLIC_API_BASE_URL', () => {
		vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', 'http://api.test/');

		expect(createServerMountainApi()).toBeInstanceOf(HttpMountainApi);
	});

	it('fails fast when the base URL is not configured', () => {
		vi.stubEnv('NEXT_PUBLIC_API_BASE_URL', '');

		expect(() => createServerMountainApi()).toThrow(InvalidPublicConfigError);
	});
});
