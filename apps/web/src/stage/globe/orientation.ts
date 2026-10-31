const CARDINALS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
const VERTICAL_LOOK_EPSILON = 0.001;
const HORIZONTAL_EPSILON_METERS = 1e-6;

export type CardinalLabel = (typeof CARDINALS)[number];

const SPOKEN: Record<CardinalLabel, string> = {
	N: 'north',
	NE: 'northeast',
	E: 'east',
	SE: 'southeast',
	S: 'south',
	SW: 'southwest',
	W: 'west',
	NW: 'northwest'
};

export interface ViewOrientation {
	viewHeadingDegrees: number;
}

export function normalizeDegrees(degrees: number): number {
	if (!Number.isFinite(degrees)) {
		return Number.NaN;
	}
	return ((degrees % 360) + 360) % 360;
}

export function degreesFromRadians(radians: number): number {
	if (!Number.isFinite(radians)) {
		return Number.NaN;
	}
	return normalizeDegrees((radians * 180) / Math.PI);
}

export function displayHeadingDegrees(degrees: number): number {
	const normalized = normalizeDegrees(degrees);
	if (!Number.isFinite(normalized)) {
		return Number.NaN;
	}
	return Math.round(normalized) % 360;
}

export function cardinalLabel(degrees: number): CardinalLabel | undefined {
	const normalized = normalizeDegrees(degrees);
	if (!Number.isFinite(normalized)) {
		return undefined;
	}
	return CARDINALS[Math.floor(((normalized + 22.5) % 360) / 45)];
}

export function formatBearing(degrees: number): string | undefined {
	const shown = displayHeadingDegrees(degrees);
	const cardinal = cardinalLabel(degrees);
	if (!Number.isFinite(shown) || !cardinal) {
		return undefined;
	}
	return `${shown}° · ${cardinal}`;
}

export function compassSpokenLabel(degrees: number): string | undefined {
	const shown = displayHeadingDegrees(degrees);
	const cardinal = cardinalLabel(degrees);
	if (!Number.isFinite(shown) || !cardinal) {
		return undefined;
	}
	return `Compass. Looking ${shown} degrees ${SPOKEN[cardinal]}.`;
}

export function compassRoseRotationDegrees(headingDegrees: number): number {
	const heading = normalizeDegrees(headingDegrees);
	if (!Number.isFinite(heading)) {
		return Number.NaN;
	}
	return heading === 0 ? 0 : -heading;
}

export function viewHeadingDegrees(
	directionEast: number,
	directionNorth: number,
	directionUp: number,
	upEast = 0,
	upNorth = 1
): number {
	if (
		!Number.isFinite(directionEast) ||
		!Number.isFinite(directionNorth) ||
		!Number.isFinite(directionUp) ||
		!Number.isFinite(upEast) ||
		!Number.isFinite(upNorth)
	) {
		return Number.NaN;
	}
	const vertical = Math.abs(Math.abs(directionUp) - 1) <= VERTICAL_LOOK_EPSILON;
	const east = vertical ? upEast : directionEast;
	const north = vertical ? upNorth : directionNorth;
	if (!(Math.hypot(east, north) > 0)) {
		return Number.NaN;
	}
	return normalizeDegrees((Math.atan2(east, north) * 180) / Math.PI);
}

export function viewpointBearingDegrees(eastMeters: number, northMeters: number): number {
	if (!Number.isFinite(eastMeters) || !Number.isFinite(northMeters)) {
		return Number.NaN;
	}
	if (!(Math.hypot(eastMeters, northMeters) > HORIZONTAL_EPSILON_METERS)) {
		return Number.NaN;
	}
	return normalizeDegrees((Math.atan2(eastMeters, northMeters) * 180) / Math.PI);
}
