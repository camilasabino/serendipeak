import type { MountainIndexEntry } from '../api/contract';
import { formatElevation } from '../formatElevation';
import { formatCountries, formatRegion } from '../mountain-page/format';

// Where a result is, as concisely as the data allows: its countries, else its region, else its
// continent, which every mountain has.
export function placeOf({ countries, region, continent }: MountainIndexEntry): string {
	if (countries.length > 0) {
		return formatCountries(countries.map((country) => country.name));
	}

	return region === null ? continent.name : formatRegion(region);
}

export function describeResult(entry: MountainIndexEntry): string {
	return `${placeOf(entry)} · ${formatElevation(entry.elevationMeters)}`;
}
