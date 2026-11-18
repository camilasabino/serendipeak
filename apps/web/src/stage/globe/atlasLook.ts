/**
 * The dark treatment of the atlas globe: how far it applies and what it does at full strength.
 * Pure data and arithmetic; the Cesium scene that wears it lives in `cesium/AtlasLook.ts`.
 *
 * The values are the "B2" recipe, tuned on production imagery: dark and still photographic, with
 * snow, coastlines and relief readable. At full strength it suits the whole-globe overview and is
 * too dull close to terrain, so it fades out with altitude and only the atlas ever wears it.
 */
export const ATLAS_LOOK = {
	/** `--sp-basalt`, the colour of the surrounding chrome: the void behind the globe. */
	background: { red: 0x11 / 255, green: 0x0f / 255, blue: 0x0e / 255 },
	skyAtmosphere: { saturationShift: -0.6, brightnessShift: -0.35 },
	groundAtmosphere: { saturationShift: -0.6, brightnessShift: -0.2 },
	layer: { saturation: 0.65, brightness: 0.85, contrast: 1.1 },
	/**
	 * Full strength from here up: the continental-scale views and the whole-globe overview, which
	 * frames the Earth between about 15,000 and 22,000 km depending on the stage.
	 */
	fullAboveMeters: 6_000_000,
	/**
	 * Gone from here down. The look was judged too dull at 90 km and acceptable at 2,500 km; a
	 * regional view, where relief and vegetation carry the photograph, starts from the original.
	 */
	absentBelowMeters: 1_000_000,
	/**
	 * Entering or leaving the atlas. Shorter than the quickest mountain flight (1.5 s), so a look
	 * that is leaving is finished while the camera is still travelling, never after it has landed.
	 */
	fadeSeconds: 0.7,
	/** Below this strength the look is not drawn at all, and above it a change smaller than this is not rewritten. */
	minStep: 1 / 256
} as const;

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

export function mix(from: number, to: number, amount: number): number {
	return from + (to - from) * amount;
}

/**
 * How much of the look the camera's height allows: 1 high above the globe, 0 near terrain, and a
 * smoothstep on the logarithm of the height between, so every doubling of altitude changes the
 * look by a similar amount. A height that cannot be read allows none.
 */
export function atlasLookAltitudeWeight(heightMeters: number): number {
	const { absentBelowMeters, fullAboveMeters } = ATLAS_LOOK;
	if (!Number.isFinite(heightMeters) || heightMeters <= absentBelowMeters) {
		return 0;
	}
	const t = clamp01(
		Math.log(heightMeters / absentBelowMeters) / Math.log(fullAboveMeters / absentBelowMeters)
	);

	return t * t * (3 - 2 * t);
}

/** How far the stage has gone into the atlas presentation, 0 to 1, eased so a fade has no hard ends. */
export function easePresentation(progress: number): number {
	const t = clamp01(progress);

	return t * t * (3 - 2 * t);
}

/** Moves `progress` toward `target` (0 or 1) by the share of a fade that `elapsedSeconds` covers. */
export function advancePresentation(
	progress: number,
	target: 0 | 1,
	elapsedSeconds: number
): number {
	const step = Math.max(0, elapsedSeconds) / ATLAS_LOOK.fadeSeconds;

	return target === 1 ? Math.min(1, progress + step) : Math.max(0, progress - step);
}

/**
 * How strongly the look is worn: the atlas presentation times what the altitude allows. A value
 * under `minStep` is zero, so the original scene comes back exactly rather than asymptotically.
 */
export function atlasLookIntensity(presentation: number, heightMeters: number): number {
	const strength = easePresentation(presentation) * atlasLookAltitudeWeight(heightMeters);

	return strength < ATLAS_LOOK.minStep ? 0 : strength;
}

/** What a test or diagnostic reads back from the live scene. */
export interface AtlasLookReading {
	/** The strength last written to the scene, 0 when the scene is untouched. */
	intensity: number;
	/** Whether a frame listener is registered; false once the look has settled at zero. */
	listening: boolean;
	skyBoxShown: boolean | undefined;
	layerSaturation: number | undefined;
	background: { red: number; green: number; blue: number };
}

export type ExposeAtlasLook = (read: () => AtlasLookReading | undefined) => () => void;
