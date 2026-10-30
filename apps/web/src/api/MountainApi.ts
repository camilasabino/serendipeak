import type { DailyMountainResult, MountainResult, RandomMountainResult } from './contract';

export interface MountainApi {
	getMountain(slug: string): Promise<MountainResult>;
	getDailyMountain(): Promise<DailyMountainResult>;
	getRandomMountain(exclude?: string): Promise<RandomMountainResult>;
}
