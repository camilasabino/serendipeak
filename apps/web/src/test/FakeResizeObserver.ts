export class FakeResizeObserver {
	static instances: FakeResizeObserver[] = [];

	readonly observed = new Set<unknown>();
	disconnected = false;

	constructor(private readonly callback: () => void) {
		FakeResizeObserver.instances.push(this);
	}

	observe(target: unknown): void {
		this.observed.add(target);
	}

	unobserve(target: unknown): void {
		this.observed.delete(target);
	}

	disconnect(): void {
		this.disconnected = true;
		this.observed.clear();
	}

	fire(): void {
		if (this.observed.size > 0) {
			this.callback();
		}
	}

	static reset(): void {
		FakeResizeObserver.instances = [];
	}
}

export interface FakeViewport {
	clientWidth: number;
	clientHeight: number;
}
