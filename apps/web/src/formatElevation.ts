const integerFormat = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

export function formatElevation(meters: number): string {
	return `${integerFormat.format(meters)} m`;
}
