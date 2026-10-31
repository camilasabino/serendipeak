import { lookFromOffset } from './choreography';
import type { SceneTarget } from './camera';
import type { LookState } from './glidePath';
import type { CesiumCameraOffset } from './terrainCamera';

export const RESET_TOLERANCE = {
	angleDegrees: 0.5,
	rangeFraction: 0.005,
	framing: 0.01
} as const;

function angleDelta(a: number, b: number): number {
	const delta = Math.abs((((a - b) % 360) + 360) % 360);
	return delta > 180 ? 360 - delta : delta;
}

export function isLookAtOffset(
	look: LookState,
	target: SceneTarget,
	offset: CesiumCameraOffset,
	{ framing = true }: { framing?: boolean } = {}
): boolean {
	const expected = lookFromOffset(target, offset);
	return (
		angleDelta(look.headingDegrees, expected.headingDegrees) <= RESET_TOLERANCE.angleDegrees &&
		Math.abs(look.pitchDegrees - expected.pitchDegrees) <= RESET_TOLERANCE.angleDegrees &&
		Math.abs(look.rangeMeters - expected.rangeMeters) <=
			expected.rangeMeters * RESET_TOLERANCE.rangeFraction &&
		(!framing ||
			(Math.abs(look.framingX - expected.framingX) <= RESET_TOLERANCE.framing &&
				Math.abs(look.framingY - expected.framingY) <= RESET_TOLERANCE.framing))
	);
}
