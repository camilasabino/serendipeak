import { describe, expect, it } from 'vitest';
import type { Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { toSceneTarget } from './sceneTarget';

const complete = contractFixture('mountain-complete.json') as Mountain;
const minimal = contractFixture('mountain-minimal.json') as Mountain;

describe('toSceneTarget', () => {
	it('keeps only the fields the scene needs and the curated camera', () => {
		expect(toSceneTarget(complete)).toEqual({
			slug: complete.slug,
			name: complete.name,
			latitude: complete.coordinates.latitude,
			longitude: complete.coordinates.longitude,
			elevationMeters: complete.elevationMeters,
			camera: complete.camera
		});
	});

	it('leaves the camera out when the mountain has none', () => {
		expect(toSceneTarget(minimal)).not.toHaveProperty('camera');
	});
});
