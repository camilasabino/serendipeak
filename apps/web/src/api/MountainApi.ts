import type {
	DailyMountainResult,
	MountainIndexResult,
	MountainResult,
	RandomMountainResult
} from './contract';

export interface MountainApi {
	getMountain(slug: string): Promise<MountainResult>;
	// `fresh` skips every HTTP cache for a server-side consumer that must not publish a stale answer.
	getMountainIndex(options?: { fresh?: boolean }): Promise<MountainIndexResult>;
	getDailyMountain(): Promise<DailyMountainResult>;
	getRandomMountain(exclude?: string): Promise<RandomMountainResult>;
}

// Kept apart from MountainApi: only the server reads a preview, so the browser-side API never
// carries the token.
export interface MountainPreviewApi {
	getMountainPreview(token: string): Promise<MountainResult>;
}
