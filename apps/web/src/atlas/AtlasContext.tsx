import { ATLAS_TRAIL_LABEL, backToLabel } from './atlasCopy';
import styles from './AtlasContext.module.css';

/** The heading that says where the reader is; focus is moved to it when the level changes. */
export const LIST_HEADING_ID = 'atlas-list-heading';

export interface TrailStep {
	/** The name of the place the step leads to. */
	label: string;
	onSelect: () => void;
	/** Spoken in place of "Back to" and the label, for a step that does something more than go up. */
	accessibleLabel?: string;
}

/**
 * Where the reader is, set before the controls that act on it: the way up from here, the one
 * heading that names the level, and what it holds when that is worth saying. The trail is a
 * list of places, each a button that goes straight to it; the last is the level directly above,
 * which is what going back means, so it is named for that. Only the initial level, with nothing
 * above it, sets its heading as a quiet label; the heading is the one prominent line otherwise.
 */
export function AtlasContext({
	heading,
	meta,
	steps,
	initial = false
}: {
	heading: string;
	meta?: string;
	steps: readonly TrailStep[];
	initial?: boolean;
}) {
	return (
		<div className={styles.context}>
			{steps.length > 0 && (
				<nav aria-label={ATLAS_TRAIL_LABEL}>
					<ol className={styles.trail}>
						{steps.map((step, index) => (
							<li key={step.label}>
								{index > 0 && (
									<span className={styles.separator} aria-hidden="true">
										›
									</span>
								)}
								<button
									type="button"
									className={styles.crumb}
									aria-label={
										index === steps.length - 1
											? (step.accessibleLabel ?? backToLabel(step.label))
											: undefined
									}
									onClick={step.onSelect}
								>
									{index === 0 && (
										<svg className={styles.arrow} viewBox="0 0 24 24" aria-hidden="true">
											<path d="M15 6l-6 6 6 6" />
										</svg>
									)}
									<span>{step.label}</span>
								</button>
							</li>
						))}
					</ol>
				</nav>
			)}
			<h2
				id={LIST_HEADING_ID}
				tabIndex={-1}
				className={initial ? styles.quietHeading : styles.heading}
			>
				{heading}
			</h2>
			{meta && <p className={styles.meta}>{meta}</p>}
		</div>
	);
}
