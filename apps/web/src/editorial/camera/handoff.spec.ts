import { describe, expect, it } from 'vitest';
import { cameraHandoffUrl, mountainStudioUrl, saveDestination } from './handoff';

const ID = '3f2b8c1e-5a47-4d7e-9a3b-0c1d2e3f4a5b';
const MOUNTAIN = { id: ID, slug: 'cerro-plomo' };
const COMPOSED_ON = { latitude: -32.6531487, longitude: -70.0119607 };
const COMPOSED_QUERY = `lat=-32.6531487&lon=-70.0119607&mountain=${ID}`;
const CAMERA = {
	headingDegrees: 123.45,
	pitchDegrees: -12.5,
	rangeMeters: 4321,
	framing: { x: 0.125, y: -0.25 }
};

describe('cameraHandoffUrl', () => {
	it('opens the Studio confirmation of the mountain with the camera and the coordinates it was composed on', () => {
		expect(cameraHandoffUrl('http://localhost:8000', MOUNTAIN, CAMERA, COMPOSED_ON)).toBe(
			`http://localhost:8000/studio/mountains/cerro-plomo/camera/?heading=123.45&pitch=-12.5&range=4321&fx=0.125&fy=-0.25&${COMPOSED_QUERY}`
		);
	});

	it.each([
		['a negative latitude and longitude', { latitude: -0.5, longitude: -179.999999 }],
		['zero', { latitude: 0, longitude: 0 }],
		['a long fraction', { latitude: 46.123456789012345, longitude: 8.987654321098765 }]
	])('carries %s so that the Studio reads back the very same numbers', (_, composedOn) => {
		const url = new URL(cameraHandoffUrl('https://api.example', MOUNTAIN, CAMERA, composedOn));

		expect(Number(url.searchParams.get('lat'))).toBe(composedOn.latitude);
		expect(Number(url.searchParams.get('lon'))).toBe(composedOn.longitude);
	});

	it('writes zero as plain 0 and keeps the sign of negative values', () => {
		const url = cameraHandoffUrl(
			'https://api.example',
			MOUNTAIN,
			{
				...CAMERA,
				headingDegrees: 0,
				framing: { x: 0, y: -0.0001 }
			},
			COMPOSED_ON
		);

		expect(url).toContain('heading=0&');
		expect(url).toContain('fx=0&fy=-0.0001');
	});

	it('round-trips every value through the query string unchanged', () => {
		const url = new URL(cameraHandoffUrl('https://api.example', MOUNTAIN, CAMERA, COMPOSED_ON));

		expect(Object.fromEntries(url.searchParams)).toEqual({
			heading: '123.45',
			pitch: '-12.5',
			range: '4321',
			fx: '0.125',
			fy: '-0.25',
			lat: '-32.6531487',
			lon: '-70.0119607',
			mountain: ID
		});
	});
});

describe('mountainStudioUrl', () => {
	it('returns to the page of the same mountain', () => {
		expect(mountainStudioUrl('https://api.example', 'cerro-plomo')).toBe(
			'https://api.example/studio/mountains/cerro-plomo/'
		);
	});
});

describe('saveDestination', () => {
	const STUDIO = 'http://localhost:8000';

	it('goes to the Studio confirmation with the quantized reading', () => {
		const destination = saveDestination(
			{
				headingDegrees: 123.456,
				pitchDegrees: -12.5,
				rangeMeters: 4321.4,
				framing: { x: 0.125, y: -0.25 }
			},
			STUDIO,
			MOUNTAIN,
			COMPOSED_ON
		);

		expect(destination).toBe(
			`${STUDIO}/studio/mountains/cerro-plomo/camera/?heading=123.46&pitch=-12.5&range=4321&fx=0.125&fy=-0.25&${COMPOSED_QUERY}`
		);
	});

	it('refuses to save while the pose cannot be read, as during a flight or a restore', () => {
		expect(saveDestination(undefined, STUDIO, MOUNTAIN, COMPOSED_ON)).toBeUndefined();
	});

	it.each([
		['no framing', { headingDegrees: 10, pitchDegrees: -12.5, rangeMeters: 4321 }],
		[
			'the summit off screen',
			{ headingDegrees: 10, pitchDegrees: -12.5, rangeMeters: 4321, framing: { x: 1.2, y: 0 } }
		],
		[
			'a range out of bounds',
			{ headingDegrees: 10, pitchDegrees: -12.5, rangeMeters: 90_000, framing: { x: 0, y: 0 } }
		],
		[
			'a pose that is not a number',
			{
				headingDegrees: Number.NaN,
				pitchDegrees: -12.5,
				rangeMeters: 4321,
				framing: { x: 0, y: 0 }
			}
		]
	])('refuses to save a pose with %s', (_, reading) => {
		expect(saveDestination(reading, STUDIO, MOUNTAIN, COMPOSED_ON)).toBeUndefined();
	});
});
