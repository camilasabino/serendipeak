import type { Mountain } from '../api/contract';
import type { SceneTarget } from '../stage/globe/camera';

export function toSceneTarget(mountain: Mountain): SceneTarget {
	const target: SceneTarget = {
		slug: mountain.slug,
		name: mountain.name,
		latitude: mountain.coordinates.latitude,
		longitude: mountain.coordinates.longitude,
		elevationMeters: mountain.elevationMeters
	};
	if (mountain.camera) {
		target.camera = mountain.camera;
	}

	return target;
}
