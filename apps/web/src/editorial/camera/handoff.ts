import type { SceneCamera } from '../../stage/globe/camera';
import { assessCamera, type CanonicalCamera } from './canonicalCamera';

const MOUNTAIN_ADMIN_PATH = '/admin/catalog/mountainrecord';

// The Admin is located by build configuration and the mountain id has been validated as a UUID,
// so no part of the editor's query can steer where the browser goes.
export function mountainAdminUrl(adminBaseUrl: string, mountainId: string): string {
	return `${adminBaseUrl}${MOUNTAIN_ADMIN_PATH}/${mountainId}/change/`;
}

// A top-level navigation to the Admin confirmation page, which only displays the proposal; the
// Admin's own CSRF-protected form is what saves it.
export function cameraHandoffUrl(
	adminBaseUrl: string,
	mountainId: string,
	camera: CanonicalCamera
): string {
	const query = new URLSearchParams({
		heading: String(camera.headingDegrees),
		pitch: String(camera.pitchDegrees),
		range: String(camera.rangeMeters),
		fx: String(camera.framing.x),
		fy: String(camera.framing.y)
	});

	return `${adminBaseUrl}${MOUNTAIN_ADMIN_PATH}/${mountainId}/camera/?${query}`;
}

// Where Save goes, if anywhere: nothing is saved from a pose that cannot be read (the view is
// moving) or that the catalog would reject, so the click is refused rather than sent on.
export function saveDestination(
	reading: SceneCamera | undefined,
	adminBaseUrl: string,
	mountainId: string
): string | undefined {
	const assessment = reading ? assessCamera(reading) : undefined;

	return assessment?.valid
		? cameraHandoffUrl(adminBaseUrl, mountainId, assessment.camera)
		: undefined;
}
