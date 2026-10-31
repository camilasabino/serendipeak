import { describe, expect, it } from 'vitest';
import type { SceneTarget } from './globe/camera';
import { sameSceneTarget } from './sceneTarget';

const TARGET: SceneTarget = {
	slug: 'aconcagua',
	name: 'Aconcagua',
	latitude: -32.65,
	longitude: -70.01,
	elevationMeters: 6961,
	camera: {
		headingDegrees: 66.87,
		pitchDegrees: -19.85,
		rangeMeters: 17132,
		framing: { x: -0.0587, y: 0.3857 }
	}
};

describe('sameSceneTarget', () => {
	it('treats a rebuilt target with the same content as the same target', () => {
		const rebuilt: SceneTarget = JSON.parse(JSON.stringify(TARGET));

		expect(sameSceneTarget(TARGET, rebuilt)).toBe(true);
	});

	it('is true for two absent targets and false for one absent target', () => {
		expect(sameSceneTarget(undefined, undefined)).toBe(true);
		expect(sameSceneTarget(TARGET, undefined)).toBe(false);
		expect(sameSceneTarget(undefined, TARGET)).toBe(false);
	});

	it.each([
		['slug', { slug: 'fitz-roy' }],
		['name', { name: 'Cerro Aconcagua' }],
		['latitude', { latitude: -32.7 }],
		['longitude', { longitude: -70.02 }],
		['elevation', { elevationMeters: 6960 }],
		['camera removed', { camera: undefined }],
		['camera heading', { camera: { ...TARGET.camera!, headingDegrees: 70 } }],
		['camera range', { camera: { ...TARGET.camera!, rangeMeters: 18000 } }],
		['camera framing', { camera: { ...TARGET.camera!, framing: { x: 0, y: 0.3857 } } }],
		['camera framing removed', { camera: { ...TARGET.camera!, framing: undefined } }]
	])('detects a different %s', (_name, change) => {
		expect(sameSceneTarget(TARGET, { ...TARGET, ...change })).toBe(false);
	});
});
