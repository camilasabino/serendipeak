import type { SceneTarget } from './globe/camera';
import type { PresentationObserver, PresentationOutcome } from './SceneSession';

// `superseded` means a newer destination won; `interrupted` means nothing newer replaced it but the
// presentation will not finish (cancelled by its owner, aborted, or the scene session ended).
export type TransitionOutcome = PresentationOutcome | 'superseded';

export interface Transition {
	readonly destination: string;
	/** Settles exactly once and never rejects. */
	readonly arrival: Promise<TransitionOutcome>;
	/** Abandons the transition if it is still the current one. */
	cancel(): void;
}

interface Pending {
	readonly destination: string;
	readonly settle: (outcome: TransitionOutcome) => void;
}

interface ScenePresentation {
	readonly slug: string;
	outcome: PresentationOutcome | undefined;
}

export class TransitionCoordinator implements PresentationObserver {
	private current: Pending | undefined;
	private presentation: ScenePresentation | undefined;

	begin(destination: string): Transition {
		this.settleCurrent('superseded');

		let settle: (outcome: TransitionOutcome) => void = () => {};
		const arrival = new Promise<TransitionOutcome>((resolve) => {
			settle = resolve;
		});
		const pending: Pending = { destination, settle };
		this.current = pending;

		// The scene may already be at, or on its way to, the destination: no report will follow for it.
		if (this.presentation?.slug === destination && this.presentation.outcome !== undefined) {
			this.settleCurrent(this.presentation.outcome);
		}

		return {
			destination,
			arrival,
			cancel: () => {
				if (this.current === pending) {
					this.settleCurrent('interrupted');
				}
			}
		};
	}

	presenting(target: SceneTarget): void {
		this.presentation = { slug: target.slug, outcome: undefined };
		if (this.current && this.current.destination !== target.slug) {
			this.settleCurrent('superseded');
		}
	}

	presented(target: SceneTarget, outcome: PresentationOutcome): void {
		if (this.presentation?.slug === target.slug) {
			this.presentation.outcome = outcome;
		}
		if (this.current?.destination === target.slug) {
			this.settleCurrent(outcome);
		}
	}

	// The scene let go of its mountain: nothing pending will be presented any more.
	cleared(): void {
		this.presentation = undefined;
		this.settleCurrent('superseded');
	}

	ended(): void {
		this.presentation = undefined;
		this.settleCurrent('interrupted');
	}

	private settleCurrent(outcome: TransitionOutcome): void {
		const pending = this.current;
		this.current = undefined;
		pending?.settle(outcome);
	}
}
