export type UnitSystem = 'metric' | 'imperial';

export const DEFAULT_UNIT_SYSTEM: UnitSystem = 'metric';

export const UNIT_SYSTEMS: readonly UnitSystem[] = ['metric', 'imperial'];

/** Exact by definition of the international foot. */
export const METERS_PER_FOOT = 0.3048;

export function isUnitSystem(value: unknown): value is UnitSystem {
	return value === 'metric' || value === 'imperial';
}

export function metersToFeet(meters: number): number {
	return meters / METERS_PER_FOOT;
}

export function elevationUnit(system: UnitSystem): 'm' | 'ft' {
	return system === 'imperial' ? 'ft' : 'm';
}

/** The elevation in the system's unit, before rounding. */
export function elevationIn(meters: number, system: UnitSystem): number {
	return system === 'imperial' ? metersToFeet(meters) : meters;
}
