import type { RandomMountainResult } from '../api/contract';
import type { MountainApi } from '../api/MountainApi';
import { prefetchPrimaryImage, type ImagePreloader } from '../media/preload';
import type { Transition, TransitionCoordinator } from '../stage/TransitionCoordinator';
import { API_ERROR_MESSAGE, NO_ELIGIBLE_MESSAGE, UNREACHABLE_MESSAGE } from './exploreCopy';

export type ExploreState =
	{ status: 'idle' } | { status: 'loading' } | { status: 'failed'; message: string; from: string };

export interface ExplorerOptions {
	api: Pick<MountainApi, 'getRandomMountain'>;
	coordinator: Pick<TransitionCoordinator, 'begin'>;
	preloader: ImagePreloader;
	/** Resolves true once the destination route is shown, false when a newer navigation replaced it. */
	navigate: (slug: string) => Promise<boolean>;
	onError?: (error: unknown) => void;
}

interface Run {
	transition?: Transition;
}

const IDLE: ExploreState = { status: 'idle' };

function reportUnexpectedError(error: unknown): void {
	console.error('Explore failed unexpectedly', error);
}

function failureMessage(result: Exclude<RandomMountainResult, { kind: 'found' }>): string {
	switch (result.kind) {
		case 'unreachable':
			return UNREACHABLE_MESSAGE;
		case 'no-eligible-mountains':
			return NO_ELIGIBLE_MESSAGE;
		default:
			return API_ERROR_MESSAGE;
	}
}

export class Explorer {
	private snapshot: ExploreState = IDLE;
	private run: Run | undefined;
	private readonly listeners = new Set<() => void>();
	private readonly onError: (error: unknown) => void;

	constructor(private readonly options: ExplorerOptions) {
		this.onError = options.onError ?? reportUnexpectedError;
	}

	// Arrow properties because React receives them detached (useSyncExternalStore).
	readonly subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	readonly getSnapshot = (): ExploreState => this.snapshot;

	async explore(currentSlug: string): Promise<void> {
		if (this.run) {
			return;
		}
		const run: Run = {};
		this.run = run;
		this.publish({ status: 'loading' });

		try {
			await this.travelFrom(currentSlug, run);
		} catch (error) {
			run.transition?.cancel();
			this.onError(error);
			this.publishIfCurrent(run, {
				status: 'failed',
				message: API_ERROR_MESSAGE,
				from: currentSlug
			});
		} finally {
			if (this.run === run) {
				this.run = undefined;
			}
		}
	}

	// Leaves the explorer usable again: a remounted control (Strict Mode) reuses the same instance.
	cancel(): void {
		const run = this.run;
		this.run = undefined;
		run?.transition?.cancel();
		this.publish(IDLE);
	}

	private async travelFrom(currentSlug: string, run: Run): Promise<void> {
		const { api, coordinator, preloader, navigate } = this.options;

		const result = await api.getRandomMountain(currentSlug);
		if (this.run !== run) {
			return;
		}
		if (result.kind !== 'found') {
			this.publish({ status: 'failed', message: failureMessage(result), from: currentSlug });
			return;
		}

		const { mountain } = result;
		this.warm(() => prefetchPrimaryImage(preloader, mountain.primaryImage));

		const transition = coordinator.begin(mountain.slug);
		run.transition = transition;
		const navigated = await navigate(mountain.slug);
		if (navigated) {
			await transition.arrival;
		} else {
			transition.cancel();
		}
		this.publishIfCurrent(run, IDLE);
	}

	private warm(preload: () => void): void {
		try {
			preload();
		} catch (error) {
			this.onError(error);
		}
	}

	private publishIfCurrent(run: Run, state: ExploreState): void {
		if (this.run === run) {
			this.publish(state);
		}
	}

	private publish(state: ExploreState): void {
		if (state.status === 'idle' && this.snapshot.status === 'idle') {
			return;
		}
		this.snapshot = state;
		for (const listener of [...this.listeners]) {
			listener();
		}
	}
}
