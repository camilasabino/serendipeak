import type { SceneTarget } from './globe/camera';

export function sameSceneTarget(a: SceneTarget | undefined, b: SceneTarget | undefined): boolean {
	if (a === b) {
		return true;
	}
	if (!a || !b) {
		return false;
	}

	return (
		a.slug === b.slug &&
		a.name === b.name &&
		a.latitude === b.latitude &&
		a.longitude === b.longitude &&
		a.elevationMeters === b.elevationMeters &&
		sameCamera(a.camera, b.camera)
	);
}

function sameCamera(a: SceneTarget['camera'], b: SceneTarget['camera']): boolean {
	if (!a || !b) {
		return a === b;
	}

	return (
		a.headingDegrees === b.headingDegrees &&
		a.pitchDegrees === b.pitchDegrees &&
		a.rangeMeters === b.rangeMeters &&
		a.framing?.x === b.framing?.x &&
		a.framing?.y === b.framing?.y
	);
}
