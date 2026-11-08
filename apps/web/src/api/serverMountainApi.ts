import { readPublicConfig } from '../config/readPublicConfig';
import { HttpMountainApi } from './HttpMountainApi';
import type { MountainApi, MountainPreviewApi } from './MountainApi';

export function createServerMountainApi(): MountainApi & MountainPreviewApi {
	const { apiBaseUrl } = readPublicConfig({
		NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL
	});

	return new HttpMountainApi({ baseUrl: apiBaseUrl });
}
