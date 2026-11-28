import { type UnitSystem } from '../units/unitSystem';

/** Exact by definition of the international mile. */
export const KILOMETERS_PER_MILE = 1.609344;

const FINE_ROUNDING_LIMIT = 100;
const COARSE_STEP = 5;

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

function distanceIn(kilometers: number, system: UnitSystem): number {
	return system === 'imperial' ? kilometers / KILOMETERS_PER_MILE : kilometers;
}

// A straight line between summits is an approximation, so a figure past a hundred is rounded to
// steps of five rather than claiming a precision it does not have. Never zero: "0 km" reads as the
// same place.
function approximate(value: number): number {
	const rounded =
		value < FINE_ROUNDING_LIMIT ? Math.round(value) : Math.round(value / COARSE_STEP) * COARSE_STEP;

	return Math.max(1, rounded);
}

export interface DistanceFigure {
	/** The grouped, rounded figure, such as "1,000". */
	value: string;
	/** The unit's abbreviation, such as "km". */
	unit: 'km' | 'mi';
	/** The distance as it is said aloud, such as "about 120 kilometers". */
	spoken: string;
}

export function describeDistance(kilometers: number, system: UnitSystem): DistanceFigure {
	const figure = approximate(distanceIn(kilometers, system));
	const value = integerFormat.format(figure);
	const word =
		system === 'imperial'
			? figure === 1
				? 'mile'
				: 'miles'
			: figure === 1
				? 'kilometer'
				: 'kilometers';

	return {
		value,
		unit: system === 'imperial' ? 'mi' : 'km',
		spoken: `about ${value} ${word}`
	};
}
