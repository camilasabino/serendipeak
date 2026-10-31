export interface ImageDimensions {
	width: number;
	height: number;
}

export type ImageOutcome = { status: 'ready'; dimensions: ImageDimensions } | { status: 'failed' };

export interface ImageLike {
	readonly complete: boolean;
	readonly naturalWidth: number;
	readonly naturalHeight: number;
	readonly currentSrc: string;
	decode?(): Promise<void>;
	addEventListener(type: 'load' | 'error', listener: () => void): void;
	removeEventListener(type: 'load' | 'error', listener: () => void): void;
}

export function watchImage(
	image: ImageLike,
	onSettled: (outcome: ImageOutcome) => void
): () => void {
	let active = true;

	function settle(outcome: ImageOutcome) {
		if (!active) {
			return;
		}

		active = false;
		detach();
		onSettled(outcome);
	}

	const painted = () => image.complete && image.naturalWidth > 0;
	const ready = (): ImageOutcome => ({
		status: 'ready',
		dimensions: { width: image.naturalWidth, height: image.naturalHeight }
	});

	function onLoad() {
		void decodeThenSettle();
	}

	function onError() {
		settle({ status: 'failed' });
	}

	function detach() {
		image.removeEventListener('load', onLoad);
		image.removeEventListener('error', onError);
	}

	function listen() {
		if (active) {
			image.addEventListener('load', onLoad);
			image.addEventListener('error', onError);
		}
	}

	async function decodeThenSettle() {
		try {
			await image.decode?.();
			settle(painted() ? ready() : { status: 'failed' });
		} catch {
			if (painted()) {
				settle(ready());
			} else if (image.complete) {
				settle({ status: 'failed' });
			} else {
				detach();
				listen();
			}
		}
	}

	if (image.complete) {
		if (image.naturalWidth > 0) {
			void decodeThenSettle();
		} else {
			settle({ status: 'failed' });
		}
	} else {
		listen();
	}

	return () => {
		active = false;
		detach();
	};
}
