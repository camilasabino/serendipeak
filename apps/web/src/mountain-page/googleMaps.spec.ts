import { describe, expect, it } from 'vitest';
import { googleMapsUrl } from './googleMaps';

function search(latitude: number, longitude: number): URL {
	return new URL(googleMapsUrl(latitude, longitude));
}

describe('googleMapsUrl', () => {
	it('uses the Maps URLs search action, which places a pin and has no zoom parameter', () => {
		const url = search(27.98806, 86.92528);

		expect(url.origin + url.pathname).toBe('https://www.google.com/maps/search/');
		expect(url.searchParams.get('api')).toBe('1');
		expect(url.searchParams.get('query')).toBe('27.98806,86.92528');
		expect(url.searchParams.has('zoom')).toBe(false);
		expect(url.searchParams.has('map_action')).toBe(false);
		expect(url.searchParams.has('center')).toBe(false);
	});

	it('encodes the coordinate comma and keeps the documented parameter order', () => {
		expect(googleMapsUrl(45.976389, 7.658333)).toBe(
			'https://www.google.com/maps/search/?api=1&query=45.976389%2C7.658333'
		);
	});

	it.each([
		[45.976389, 7.658333, '45.976389,7.658333'],
		[-32.65305556, 70.01166667, '-32.65305556,70.01166667'],
		[27.98806, -86.92528, '27.98806,-86.92528'],
		[-43.595, -170.1422, '-43.595,-170.1422'],
		[10, 179.99996, '10,179.99996'],
		[-0.00001234, -179.99996, '-0.00001234,-179.99996']
	])('keeps raw precision for %s, %s', (latitude, longitude, query) => {
		expect(search(latitude, longitude).searchParams.get('query')).toBe(query);
	});
});
