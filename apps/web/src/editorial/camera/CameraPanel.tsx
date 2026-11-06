import type { CameraAssessment } from './canonicalCamera';
import type { CameraOrigin } from './editorQuery';
import {
	BACK_LABEL,
	EDITOR_TITLE,
	SAVE_LABEL,
	STATE_COPY,
	openedOnLabel,
	problemsCopy,
	restoreLabel
} from './copy';
import styles from './CameraPanel.module.css';

export type PanelState =
	| { kind: 'unavailable' }
	| { kind: 'loading' }
	| { kind: 'flying' }
	| { kind: 'ready'; assessment: CameraAssessment };

interface CameraPanelProps {
	name: string;
	cameraOrigin: CameraOrigin;
	state: PanelState;
	/** The view can be sent back to the presented pose. */
	canRestore: boolean;
	backHref: string;
	onSave: () => void;
	onRestore: () => void;
}

export function CameraPanel({
	name,
	cameraOrigin,
	state,
	canRestore,
	backHref,
	onSave,
	onRestore
}: CameraPanelProps) {
	const assessment = state.kind === 'ready' ? state.assessment : undefined;

	return (
		<section className={styles.panel} aria-labelledby="camera-editor-name">
			<p className={styles.eyebrow}>{EDITOR_TITLE}</p>
			<h1 id="camera-editor-name" className={styles.name}>
				{name}
			</h1>
			<p className={styles.note}>{openedOnLabel(cameraOrigin)}</p>

			<dl className={styles.readout} aria-label="Live camera">
				<Value label="Heading" value={assessment && `${assessment.camera.headingDegrees}°`} />
				<Value label="Pitch" value={assessment && `${assessment.camera.pitchDegrees}°`} />
				<Value label="Range" value={assessment && `${assessment.camera.rangeMeters} m`} />
				<Value
					label="Framing"
					value={
						assessment &&
						(assessment.camera.framing
							? `${assessment.camera.framing.x}, ${assessment.camera.framing.y}`
							: 'none')
					}
				/>
			</dl>

			<div role="status" className={styles.status} data-valid={assessment?.valid ?? undefined}>
				{assessment && !assessment.valid ? (
					problemsCopy(assessment.problems).map((message) => <p key={message}>{message}</p>)
				) : (
					<p>{statusCopy(state)}</p>
				)}
			</div>

			<div className={styles.actions}>
				<button
					type="button"
					className={styles.primary}
					disabled={!assessment?.valid}
					onClick={onSave}
				>
					{SAVE_LABEL}
				</button>
				<button
					type="button"
					className={styles.secondary}
					disabled={!canRestore}
					onClick={onRestore}
				>
					{restoreLabel(cameraOrigin)}
				</button>
				<a className={styles.back} href={backHref}>
					{BACK_LABEL}
				</a>
			</div>
		</section>
	);
}

function Value({ label, value }: { label: string; value: string | undefined }) {
	return (
		<div className={styles.value}>
			<dt>{label}</dt>
			<dd>{value ?? '—'}</dd>
		</div>
	);
}

function statusCopy(state: PanelState): string {
	return state.kind === 'ready' ? STATE_COPY.ready : STATE_COPY[state.kind];
}
