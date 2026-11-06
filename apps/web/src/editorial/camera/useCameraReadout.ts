import { useEffect, useState } from 'react';
import type { SceneCamera } from '../../stage/globe/camera';
import { assessCamera, sameAssessment, type CameraAssessment } from './canonicalCamera';

// About 10 Hz: a figure that changes every frame is unreadable and re-renders the panel for nothing.
const SAMPLE_INTERVAL_MS = 100;

/**
 * The assessed live pose while `active`, sampled from the animation loop so it stops with a hidden
 * tab. It is undefined whenever the pose cannot be read, e.g. while a flight runs.
 */
export function useCameraReadout(
	read: () => SceneCamera | undefined,
	active: boolean
): CameraAssessment | undefined {
	const [readout, setReadout] = useState<CameraAssessment>();

	useEffect(() => {
		if (!active) {
			return;
		}

		let frame = 0;
		let lastSample = Number.NEGATIVE_INFINITY;
		const sample = (now: number) => {
			frame = requestAnimationFrame(sample);
			if (now - lastSample < SAMPLE_INTERVAL_MS) {
				return;
			}
			lastSample = now;
			const reading = read();
			const next = reading ? assessCamera(reading) : undefined;
			setReadout((previous) => (sameAssessment(previous, next) ? previous : next));
		};
		frame = requestAnimationFrame(sample);

		return () => cancelAnimationFrame(frame);
	}, [read, active]);

	return active ? readout : undefined;
}
