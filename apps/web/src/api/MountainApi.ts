import type { DailyMountainResult, MountainResult, RandomMountainResult } from './contract';

export interface MountainApi {
	getMountain(slug: string): Promise<MountainResult>;
	getDailyMountain(): Promise<DailyMountainResult>;
	getRandomMountain(exclude?: string): Promise<RandomMountainResult>;
}

// Kept apart from MountainApi: only the server reads a preview, so the browser-side API never
// carries the token.
export interface MountainPreviewApi {
	getMountainPreview(token: string): Promise<MountainResult>;
}
