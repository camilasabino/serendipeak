const MAPS_SEARCH = 'https://www.google.com/maps/search/';

export function googleMapsUrl(latitude: number, longitude: number): string {
	const parameters = new URLSearchParams({
		api: '1',
		query: `${latitude},${longitude}`
	});

	return `${MAPS_SEARCH}?${parameters.toString()}`;
}
