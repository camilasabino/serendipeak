import { elevationIn, type UnitSystem } from '../units/unitSystem';

/** Every band spans this many of its system's unit: 1,000 m in metric, 1,000 ft in imperial. */
export const ELEVATION_BAND_SIZE = 1000;

/**
 * Elevation bands chosen in one unit system. Each band is the half-open interval
 * [floor, floor + 1,000) in that system's unit, so a selection keeps its exact bounds whichever
 * unit is later displayed.
 */
export interface BandSelection {
	system: UnitSystem;
	/** Lower bounds in the system's unit: multiples of 1,000, ascending, each once, never empty. */
	floors: readonly number[];
}

/** The selection in its one form, or null (elevation off) when no band is left. */
export function bandSelection(system: UnitSystem, floors: readonly number[]): BandSelection | null {
	if (floors.length === 0) {
		return null;
	}

	return { system, floors: [...new Set(floors)].sort((a, b) => a - b) };
}

export function sameSelection(a: BandSelection | null, b: BandSelection | null): boolean {
	if (a === null || b === null) {
		return a === b;
	}

	return (
		a.system === b.system &&
		a.floors.length === b.floors.length &&
		a.floors.every((floor, index) => floor === b.floors[index])
	);
}

/**
 * A length in the system's unit as meters. Whole feet times 3,048 is an exact integer, and one
 * division then gives the same double as the decimal meters it equals, so a boundary such as
 * 7,000 ft compares equal to the 2,133.6 m a catalog would hold for it.
 */
function boundaryMeters(value: number, system: UnitSystem): number {
	return system === 'imperial' ? (value * 3048) / 10_000 : value;
}

/** The band's half-open interval [min, max) in meters. */
export function bandBounds(floor: number, system: UnitSystem): { min: number; max: number } {
	return {
		min: boundaryMeters(floor, system),
		max: boundaryMeters(floor + ELEVATION_BAND_SIZE, system)
	};
}

/**
 * The lower bound of the band an elevation in meters falls in, read from the unrounded
 * conversion. Dividing by 0.3048 can land a hair under a whole number of feet (2,133.6 m gives
 * 6,999.999…), so the estimate is checked against the band's exact bounds and moved by one band
 * when the division crossed one.
 */
export function bandFloorOf(meters: number, system: UnitSystem): number {
	const estimate =
		Math.floor(elevationIn(meters, system) / ELEVATION_BAND_SIZE) * ELEVATION_BAND_SIZE;
	const { min, max } = bandBounds(estimate, system);
	if (meters < min) {
		return estimate - ELEVATION_BAND_SIZE;
	}

	return meters >= max ? estimate + ELEVATION_BAND_SIZE : estimate;
}

export function inBands(meters: number, selection: BandSelection): boolean {
	return selection.floors.includes(bandFloorOf(meters, selection.system));
}
