import type { SceneCamera } from '../../stage/globe/camera';
import { assessCamera, type CanonicalCamera } from './canonicalCamera';

/** The location of the summit that the editor was opened on, as the Studio sent it. */
export interface ComposedOn {
	latitude: number;
	longitude: number;
}

const STUDIO_MOUNTAINS_PATH = '/studio/mountains';

/** The mountain as the Studio addresses it; the id guards against a slug renamed since. */
export interface StudioMountain {
	id: string;
	slug: string;
}

// The Studio is located by build configuration and the slug and id have been validated, so no
// part of the editor's query can steer where the browser goes.
export function mountainStudioUrl(studioBaseUrl: string, slug: string): string {
	return `${studioBaseUrl}${STUDIO_MOUNTAINS_PATH}/${slug}/`;
}

// A top-level navigation to the Studio confirmation page, which only displays the proposal; the
// Studio's own CSRF-protected form is what saves it. The proposal carries the coordinates it was
// composed on, because the camera is framed on that summit: the Studio refuses to store it if the
// mountain has moved since, which no comparison of cameras can tell when both are absent.
export function cameraHandoffUrl(
	studioBaseUrl: string,
	mountain: StudioMountain,
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
		lon: String(composedOn.longitude),
		mountain: mountain.id
	});

	return `${studioBaseUrl}${STUDIO_MOUNTAINS_PATH}/${mountain.slug}/camera/?${query}`;
}

// Where Save goes, if anywhere: nothing is saved from a pose that cannot be read (the view is
// moving) or that the catalog would reject, so the click is refused rather than sent on.
export function saveDestination(
	reading: SceneCamera | undefined,
	studioBaseUrl: string,
	mountain: StudioMountain,
	composedOn: ComposedOn
): string | undefined {
	const assessment = reading ? assessCamera(reading) : undefined;

	return assessment?.valid
		? cameraHandoffUrl(studioBaseUrl, mountain, assessment.camera, composedOn)
		: undefined;
}
