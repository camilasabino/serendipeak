import { readPublicConfig } from '../config/readPublicConfig';
import { HttpMountainApi } from './HttpMountainApi';
import type { MountainApi } from './MountainApi';

export function createServerMountainApi(): MountainApi {
	const { apiBaseUrl } = readPublicConfig({
		NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL
	});

	return new HttpMountainApi({ baseUrl: apiBaseUrl });
}
