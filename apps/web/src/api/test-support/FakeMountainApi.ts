import type { DailyMountainResult, MountainResult, RandomMountainResult } from '../contract';
import type { MountainApi } from '../MountainApi';

export interface FakeMountainApiResults {
	mountain?: MountainResult;
	daily?: DailyMountainResult;
	random?: RandomMountainResult;
}

export class FakeMountainApi implements MountainApi {
	readonly getMountainCalls: string[] = [];
	getDailyMountainCalls = 0;
	readonly getRandomMountainCalls: (string | undefined)[] = [];

	constructor(private readonly results: FakeMountainApiResults = {}) {}

	async getMountain(slug: string): Promise<MountainResult> {
		this.getMountainCalls.push(slug);
		return this.results.mountain ?? { kind: 'unreachable' };
	}

	async getDailyMountain(): Promise<DailyMountainResult> {
		this.getDailyMountainCalls += 1;
		return this.results.daily ?? { kind: 'unreachable' };
	}

	async getRandomMountain(exclude?: string): Promise<RandomMountainResult> {
		this.getRandomMountainCalls.push(exclude);
		return this.results.random ?? { kind: 'unreachable' };
	}
}
