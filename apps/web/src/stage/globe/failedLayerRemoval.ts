export interface RemovableLayerCollection<Layer> {
	remove(layer: Layer, destroy?: boolean): boolean;
}

export class FailedLayerRemoval<Layer> {
	private collection: RemovableLayerCollection<Layer> | undefined;
	private failed = false;
	private isRemoved = false;
	private released = false;

	constructor(private readonly layer: Layer) {}

	get removed(): boolean {
		return this.isRemoved;
	}

	attach(target: RemovableLayerCollection<Layer>): void {
		if (this.released) {
			return;
		}
		this.collection = target;
		this.removeWhenPossible();
	}

	layerFailed(): void {
		this.failed = true;
		this.removeWhenPossible();
	}

	release(): void {
		this.released = true;
		this.collection = undefined;
	}

	private removeWhenPossible(): void {
		if (!this.failed || !this.collection || this.isRemoved || this.released) {
			return;
		}
		this.isRemoved = true;
		this.collection.remove(this.layer, true);
	}
}
