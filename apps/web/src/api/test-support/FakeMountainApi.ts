import type {
	DailyMountainResult,
	MountainIndexResult,
	MountainResult,
	RandomMountainResult
} from '../contract';
import type { MountainApi, MountainPreviewApi } from '../MountainApi';

export interface FakeMountainApiResults {
	mountain?: MountainResult;
	daily?: DailyMountainResult;
	random?: RandomMountainResult;
	preview?: MountainResult;
	index?: MountainIndexResult;
}

export class FakeMountainApi implements MountainApi, MountainPreviewApi {
	readonly getMountainCalls: string[] = [];
	readonly getMountainPreviewCalls: string[] = [];
	getDailyMountainCalls = 0;
	getMountainIndexCalls = 0;
	readonly getMountainIndexOptions: ({ fresh?: boolean } | undefined)[] = [];
	readonly getRandomMountainCalls: (string | undefined)[] = [];

	constructor(private readonly results: FakeMountainApiResults = {}) {}

	async getMountain(slug: string): Promise<MountainResult> {
		this.getMountainCalls.push(slug);
		return this.results.mountain ?? { kind: 'unreachable' };
	}

	async getMountainIndex(options?: { fresh?: boolean }): Promise<MountainIndexResult> {
		this.getMountainIndexCalls += 1;
		this.getMountainIndexOptions.push(options);
		return this.results.index ?? { kind: 'unreachable' };
	}

	async getMountainPreview(token: string): Promise<MountainResult> {
		this.getMountainPreviewCalls.push(token);
		return this.results.preview ?? { kind: 'unreachable' };
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
