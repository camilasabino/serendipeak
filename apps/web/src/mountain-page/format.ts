import type { Coordinates, Region } from '../api/contract';

const COORDINATE_DECIMALS = 4;

const countryList = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' });

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

// The region and its nearest ancestor, for example "Cordillera Blanca, Andes". The contract keeps
// the whole path so that a later page can show every ancestor.
export function formatRegion({ name, ancestors }: Region): string {
	const parent = ancestors.at(-1);

	return parent === undefined ? name : `${name}, ${parent.name}`;
}
