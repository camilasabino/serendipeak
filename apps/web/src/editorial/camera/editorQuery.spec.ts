import { describe, expect, it } from 'vitest';
import { parseEditorQuery, type EditorQuery } from './editorQuery';

const ID = '3f2b8c1e-5a47-4d7e-9a3b-0c1d2e3f4a5b';
const BASE: EditorQuery = {
	mountain: ID,
	slug: 'aconcagua',
	name: 'Aconcagua',
	lat: '-32.6532',
	lon: '-70.0109',
	elevation: '6961'
};
const CAMERA: EditorQuery = {
	heading: '123.45',
	pitch: '-12.5',
	range: '4321',
	fx: '0.125',
	fy: '-0.25'
};

describe('parseEditorQuery', () => {
	it('reads the target of a mountain without a stored camera', () => {
		expect(parseEditorQuery(BASE)).toEqual({
			ok: true,
			request: {
				mountainId: ID,
				target: {
					slug: 'aconcagua',
					name: 'Aconcagua',
					latitude: -32.6532,
					longitude: -70.0109,
					elevationMeters: 6961
				},
				cameraOrigin: 'none'
			}
		});
	});

	it('adds the stored camera, framing included, when the link carries one', () => {
		const result = parseEditorQuery({ ...BASE, ...CAMERA });

		expect(result).toMatchObject({
			ok: true,
			request: {
				cameraOrigin: 'saved',
				target: {
					camera: {
						headingDegrees: 123.45,
						pitchDegrees: -12.5,
						rangeMeters: 4321,
						framing: { x: 0.125, y: -0.25 }
					}
				}
			}
		});
	});

	it('accepts a stored camera without framing', () => {
		const { fx, fy, ...pose } = CAMERA;
		void fx;
		void fy;
		const result = parseEditorQuery({ ...BASE, ...pose });

		expect(result.ok && result.request.target.camera).toEqual({
			headingDegrees: 123.45,
			pitchDegrees: -12.5,
			rangeMeters: 4321
		});
	});

	it('reads the exponent and long forms that Django renders for floats', () => {
		const result = parseEditorQuery({
			...BASE,
			...CAMERA,
			heading: '359.99999999999994',
			fx: '1e-05',
			fy: '-0.30000000000000004'
		});

		expect(result.ok && result.request.target.camera).toMatchObject({
			headingDegrees: 359.99999999999994,
			framing: { x: 1e-5, y: -0.30000000000000004 }
		});
	});

	it('normalizes the mountain id to lower case', () => {
		const result = parseEditorQuery({ ...BASE, mountain: ID.toUpperCase() });

		expect(result.ok && result.request.mountainId).toBe(ID);
	});

	it.each([
		['mountain', undefined],
		['mountain', 'not-a-uuid'],
		['mountain', `${ID}/../..`],
		['slug', undefined],
		['slug', 'Not A Slug'],
		['slug', 'today'],
		['name', undefined],
		['name', '   '],
		['name', 'x'.repeat(201)],
		['lat', undefined],
		['lat', '91'],
		['lat', 'NaN'],
		['lat', 'Infinity'],
		['lat', '1e999'],
		['lat', '0x10'],
		['lat', ''],
		['lon', '-181'],
		['elevation', '0'],
		['elevation', '-5'],
		['elevation', '6961.5'],
		['elevation', 'many']
	])('rejects %s = %j', (key, value) => {
		const query = { ...BASE, [key]: value };

		expect(parseEditorQuery(query)).toEqual({ ok: false, invalid: key });
	});

	it('rejects a repeated key rather than choosing one', () => {
		expect(parseEditorQuery({ ...BASE, slug: ['a', 'b'] })).toEqual({ ok: false, invalid: 'slug' });
	});

	it.each([
		['heading', '360'],
		['heading', '-0.1'],
		['pitch', '-60.1'],
		['pitch', '15.1'],
		['range', '1999'],
		['range', '80001'],
		['fx', '1.01'],
		['fy', '-1.01'],
		['pitch', 'abc']
	])('rejects a stored camera whose %s is %s', (key, value) => {
		expect(parseEditorQuery({ ...BASE, ...CAMERA, [key]: value })).toEqual({
			ok: false,
			invalid: key
		});
	});

	it('rejects a camera that is only partly present', () => {
		expect(parseEditorQuery({ ...BASE, heading: '10' })).toEqual({ ok: false, invalid: 'pitch' });
		expect(parseEditorQuery({ ...BASE, fx: '0', fy: '0' })).toEqual({
			ok: false,
			invalid: 'heading'
		});
	});

	it('rejects a framing with only one coordinate', () => {
		const { fy, ...rest } = CAMERA;
		void fy;

		expect(parseEditorQuery({ ...BASE, ...rest })).toEqual({ ok: false, invalid: 'fy' });
	});

	describe('a proposal sent back by the Studio confirmation', () => {
		it('opens on the proposed camera and says so', () => {
			const result = parseEditorQuery({ ...BASE, ...CAMERA, proposal: '1' });

			expect(result).toMatchObject({
				ok: true,
				request: { cameraOrigin: 'proposed', target: { camera: { rangeMeters: 4321 } } }
			});
		});

		it.each([['0'], ['true'], [''], [['1', '1']]])('rejects the marker %j', (marker) => {
			expect(parseEditorQuery({ ...BASE, ...CAMERA, proposal: marker })).toEqual({
				ok: false,
				invalid: 'proposal'
			});
		});

		it('rejects the marker when there is no camera to propose', () => {
			expect(parseEditorQuery({ ...BASE, proposal: '1' })).toEqual({
				ok: false,
				invalid: 'proposal'
			});
		});

		it('still bounds-checks the proposed camera', () => {
			expect(parseEditorQuery({ ...BASE, ...CAMERA, range: '1999', proposal: '1' })).toEqual({
				ok: false,
				invalid: 'range'
			});
		});
	});
});
