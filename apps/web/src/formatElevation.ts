const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatElevationValue(meters: number): string {
	return integerFormat.format(meters);
}

export function formatElevation(meters: number): string {
	return `${formatElevationValue(meters)} m`;
}
