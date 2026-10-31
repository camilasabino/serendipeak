import type { Coordinates } from '../api/contract';

const COORDINATE_DECIMALS = 4;

const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const countryList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

export function formatElevation(meters: number): string {
	return `${integerFormat.format(meters)} m`;
}

function formatAxis(
	value: number,
	positiveLabel: string,
	negativeLabel: string,
	unlabeledMagnitudes: number[]
): string {
	const magnitude = Math.abs(value).toFixed(COORDINATE_DECIMALS);

	if (unlabeledMagnitudes.includes(Number(magnitude))) {
		return `${magnitude}°`;
	}

	return `${magnitude}° ${value < 0 ? negativeLabel : positiveLabel}`;
}

export function formatCoordinates({ latitude, longitude }: Coordinates): string {
	const formattedLatitude = formatAxis(latitude, 'N', 'S', [0]);
	const formattedLongitude = formatAxis(longitude, 'E', 'W', [0, 180]);

	return `${formattedLatitude}, ${formattedLongitude}`;
}

export function formatCountries(countries: string[]): string {
	return countryList.format(countries);
}
