export interface Destroyable {
	destroy(): void;
}

export function startScene<T extends Destroyable>(
	create: (signal: AbortSignal) => Promise<T>,
	onError: (error: unknown) => void,
	onReady?: (scene: T) => void
): () => void {
	const controller = new AbortController();
	let stopped = false;
	let scene: T | undefined;

	create(controller.signal).then(
		(created) => {
			if (stopped) {
				created.destroy();
			} else {
				scene = created;
				onReady?.(created);
			}
		},
		(error) => {
			if (!stopped) {
				onError(error);
			}
		}
	);

	return () => {
		stopped = true;
		controller.abort();
		scene?.destroy();
		scene = undefined;
	};
}
