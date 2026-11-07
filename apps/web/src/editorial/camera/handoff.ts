import type { SceneCamera } from '../../stage/globe/camera';
import { assessCamera, type CanonicalCamera } from './canonicalCamera';

/** The location of the summit that the editor was opened on, as the Admin sent it. */
export interface ComposedOn {
	latitude: number;
	longitude: number;
}

const MOUNTAIN_ADMIN_PATH = '/admin/catalog/mountainrecord';

// The Admin is located by build configuration and the mountain id has been validated as a UUID,
// so no part of the editor's query can steer where the browser goes.
export function mountainAdminUrl(adminBaseUrl: string, mountainId: string): string {
	return `${adminBaseUrl}${MOUNTAIN_ADMIN_PATH}/${mountainId}/change/`;
}

// A top-level navigation to the Admin confirmation page, which only displays the proposal; the
// Admin's own CSRF-protected form is what saves it. The proposal carries the coordinates it was
// composed on, because the camera is framed on that summit: the Admin refuses to store it if the
// mountain has moved since, which no comparison of cameras can tell when both are absent.
export function cameraHandoffUrl(
	adminBaseUrl: string,
	mountainId: string,
	camera: CanonicalCamera,
	composedOn: ComposedOn
): string {
	const query = new URLSearchParams({
		heading: String(camera.headingDegrees),
		pitch: String(camera.pitchDegrees),
		range: String(camera.rangeMeters),
		fx: String(camera.framing.x),
		fy: String(camera.framing.y),
		lat: String(composedOn.latitude),
		lon: String(composedOn.longitude)
	});

	return `${adminBaseUrl}${MOUNTAIN_ADMIN_PATH}/${mountainId}/camera/?${query}`;
}

// Where Save goes, if anywhere: nothing is saved from a pose that cannot be read (the view is
// moving) or that the catalog would reject, so the click is refused rather than sent on.
export function saveDestination(
	reading: SceneCamera | undefined,
	adminBaseUrl: string,
	mountainId: string,
	composedOn: ComposedOn
): string | undefined {
	const assessment = reading ? assessCamera(reading) : undefined;

	return assessment?.valid
		? cameraHandoffUrl(adminBaseUrl, mountainId, assessment.camera, composedOn)
		: undefined;
}
