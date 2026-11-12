import { readPublicConfig } from '../config/readPublicConfig';
import { HttpMountainApi } from './HttpMountainApi';
import type { MountainApi } from './MountainApi';

// The base URL is read on first use, not at creation: the shell renders on the server and at build
// time, where pages that never call the API (the prerendered 404 page) must not need it. A missing
// URL then rejects the call that needed it, which its caller already treats as a failure.
export function createBrowserMountainApi(): MountainApi {
	let api: MountainApi | undefined;
	const resolve = (): MountainApi => {
		api ??= new HttpMountainApi({
			baseUrl: readPublicConfig({
				NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL
			}).apiBaseUrl
		});

		return api;
	};

	return {
		getMountain: async (slug) => resolve().getMountain(slug),
		getMountainIndex: async () => resolve().getMountainIndex(),
		getDailyMountain: async () => resolve().getDailyMountain(),
		getRandomMountain: async (exclude) => resolve().getRandomMountain(exclude)
	};
}
