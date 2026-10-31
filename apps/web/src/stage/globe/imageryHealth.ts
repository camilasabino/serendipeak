export const ERROR_WINDOW_MS = 8000;
export const ERROR_THRESHOLD = 3;
const IMMEDIATE_STATUSES: readonly number[] = [401, 403, 429];

export function providerErrorStatus(error: unknown): number | undefined {
	if (typeof error !== 'object' || error === null) {
		return undefined;
	}
	const nested = (error as { error?: unknown }).error;
	for (const source of [nested, error]) {
		if (typeof source !== 'object' || source === null) {
			continue;
		}
		const status = (source as { statusCode?: unknown }).statusCode;
		if (typeof status === 'number' && Number.isInteger(status) && status >= 100 && status < 600) {
			return status;
		}
	}
	return undefined;
}

type Degradation = 'none' | 'before-ready' | 'sticky';

export class ImageryHealth {
	private degradation: Degradation = 'none';
	private providerIsReady = false;
	private errorTimes: number[] = [];

	get degraded(): boolean {
		return this.degradation !== 'none';
	}

	layerFailed(): boolean {
		if (this.degradation === 'sticky') {
			return false;
		}
		const entering = this.degradation === 'none';
		this.degradation = this.providerIsReady ? 'sticky' : 'before-ready';
		return entering;
	}

	providerReady(): boolean {
		this.providerIsReady = true;
		if (this.degradation !== 'before-ready') {
			return false;
		}
		this.degradation = 'none';
		return true;
	}

	providerError(error: unknown, at: number): boolean {
		const status = providerErrorStatus(error);
		this.errorTimes = this.errorTimes.filter((time) => at - time <= ERROR_WINDOW_MS);
		this.errorTimes.push(at);
		const persistent =
			(status !== undefined && IMMEDIATE_STATUSES.includes(status)) ||
			this.errorTimes.length >= ERROR_THRESHOLD;
		if (!persistent) {
			return false;
		}
		const entering = this.degradation === 'none';
		this.degradation = 'sticky';
		return entering;
	}
}
