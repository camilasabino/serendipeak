import { describe, expect, it } from 'vitest';
import { cameraHandoffUrl, mountainAdminUrl } from './handoff';

const ID = '3f2b8c1e-5a47-4d7e-9a3b-0c1d2e3f4a5b';
const CAMERA = {
	headingDegrees: 123.45,
	pitchDegrees: -12.5,
	rangeMeters: 4321,
	framing: { x: 0.125, y: -0.25 }
};

describe('cameraHandoffUrl', () => {
	it('opens the Admin confirmation of the mountain with the quantized camera', () => {
		expect(cameraHandoffUrl('http://localhost:8000', ID, CAMERA)).toBe(
			`http://localhost:8000/admin/catalog/mountainrecord/${ID}/camera/?heading=123.45&pitch=-12.5&range=4321&fx=0.125&fy=-0.25`
		);
	});

	it('writes zero as plain 0 and keeps the sign of negative values', () => {
		const url = cameraHandoffUrl('https://api.example', ID, {
			...CAMERA,
			headingDegrees: 0,
			framing: { x: 0, y: -0.0001 }
		});

		expect(url).toContain('heading=0&');
		expect(url).toContain('fx=0&fy=-0.0001');
	});

	it('round-trips every value through the query string unchanged', () => {
		const url = new URL(cameraHandoffUrl('https://api.example', ID, CAMERA));

		expect(Object.fromEntries(url.searchParams)).toEqual({
			heading: '123.45',
			pitch: '-12.5',
			range: '4321',
			fx: '0.125',
			fy: '-0.25'
		});
	});
});

describe('mountainAdminUrl', () => {
	it('returns to the change page of the same mountain', () => {
		expect(mountainAdminUrl('https://api.example', ID)).toBe(
			`https://api.example/admin/catalog/mountainrecord/${ID}/change/`
		);
	});
});
