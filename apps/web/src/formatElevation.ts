import {
	DEFAULT_UNIT_SYSTEM,
	elevationIn,
	elevationUnit,
	type UnitSystem
} from './units/unitSystem';

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** The grouped, whole-number figure in the system's unit; elevations are stored in meters. */
export function formatElevationValue(
	meters: number,
	system: UnitSystem = DEFAULT_UNIT_SYSTEM
): string {
	return integerFormat.format(elevationIn(meters, system));
}

export function formatElevation(meters: number, system: UnitSystem = DEFAULT_UNIT_SYSTEM): string {
	return `${formatElevationValue(meters, system)} ${elevationUnit(system)}`;
}
