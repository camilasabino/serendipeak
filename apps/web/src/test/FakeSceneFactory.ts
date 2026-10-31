import { FakeGlobeScene, createDeferred, type Deferred } from './FakeGlobeScene';
import type { FakeGlobeSceneOptions } from './FakeGlobeScene';

interface CreateCall {
	ionToken: string;
	signal: AbortSignal;
	pending: Deferred<FakeGlobeScene>;
}

export class FakeSceneFactory {
	readonly calls: CreateCall[] = [];
	readonly log: string[] = [];

	// An arrow property because SceneSession receives it as a plain function.
	readonly createScene = (ionToken: string, signal: AbortSignal): Promise<FakeGlobeScene> => {
		const pending = createDeferred<FakeGlobeScene>();
		this.calls.push({ ionToken, signal, pending });
		this.log.push(`create:${this.calls.length}`);
		return pending.promise;
	};

	resolve(index: number, options: FakeGlobeSceneOptions = {}): FakeGlobeScene {
		const scene = new FakeGlobeScene({
			...options,
			onDestroy: () => this.log.push(`destroy:${index + 1}`)
		});
		this.call(index).pending.resolve(scene);
		return scene;
	}

	reject(index: number, error: unknown): void {
		this.call(index).pending.reject(error);
	}

	private call(index: number): CreateCall {
		const call = this.calls[index];
		if (!call) {
			throw new Error(`No create call at index ${index}.`);
		}
		return call;
	}
}
