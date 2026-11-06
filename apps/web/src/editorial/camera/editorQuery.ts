import {
	isFramingInBounds,
	isHeadingInBounds,
	isPitchInBounds,
	isRangeInBounds
} from '../../api/cameraBounds';
import { isValidSlug } from '../../api/schema';
import type { SceneCamera, SceneTarget } from '../../stage/globe/camera';

export type EditorQuery = Record<string, string | string[] | undefined>;

/** Where the camera the editor opens on comes from. */
export type CameraOrigin = 'none' | 'saved' | 'proposed';

export interface EditorRequest {
	mountainId: string;
	target: SceneTarget;
	cameraOrigin: CameraOrigin;
}

export type EditorQueryResult =
	{ ok: true; request: EditorRequest } | { ok: false; invalid: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Django renders floats with repr, so exponents appear; nothing else numeric is accepted.
const DECIMAL = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;
const MAX_NAME_LENGTH = 200;

function single(query: EditorQuery, key: string): string | undefined {
	const value = query[key];

	return typeof value === 'string' ? value : undefined;
}

function number(query: EditorQuery, key: string): number | undefined {
	const raw = single(query, key);
	if (raw === undefined || !DECIMAL.test(raw)) {
		return undefined;
	}
	const value = Number(raw);

	return Number.isFinite(value) ? value : undefined;
}

type Parsed<T> = { value: T } | { invalid: string };

function parseCamera(query: EditorQuery): Parsed<SceneCamera | undefined> {
	const keys = ['heading', 'pitch', 'range', 'fx', 'fy'];
	if (keys.every((key) => query[key] === undefined)) {
		return { value: undefined };
	}

	const heading = number(query, 'heading');
	if (heading === undefined || !isHeadingInBounds(heading)) {
		return { invalid: 'heading' };
	}
	const pitch = number(query, 'pitch');
	if (pitch === undefined || !isPitchInBounds(pitch)) {
		return { invalid: 'pitch' };
	}
	const range = number(query, 'range');
	if (range === undefined || !isRangeInBounds(range)) {
		return { invalid: 'range' };
	}
	const camera: SceneCamera = { headingDegrees: heading, pitchDegrees: pitch, rangeMeters: range };

	if (query.fx === undefined && query.fy === undefined) {
		return { value: camera };
	}
	const x = number(query, 'fx');
	if (x === undefined || !isFramingInBounds(x)) {
		return { invalid: 'fx' };
	}
	const y = number(query, 'fy');
	if (y === undefined || !isFramingInBounds(y)) {
		return { invalid: 'fy' };
	}

	return { value: { ...camera, framing: { x, y } } };
}

// The editor reads everything it needs from this query and nothing else: a draft is not public, so
// there is no API to ask. A single bad value rejects the link rather than guessing around it.
export function parseEditorQuery(query: EditorQuery): EditorQueryResult {
	const mountainId = single(query, 'mountain');
	if (mountainId === undefined || !UUID.test(mountainId)) {
		return { ok: false, invalid: 'mountain' };
	}
	const slug = single(query, 'slug');
	if (!isValidSlug(slug)) {
		return { ok: false, invalid: 'slug' };
	}
	const name = single(query, 'name');
	if (name === undefined || name.trim() === '' || name.length > MAX_NAME_LENGTH) {
		return { ok: false, invalid: 'name' };
	}
	const latitude = number(query, 'lat');
	if (latitude === undefined || latitude < -90 || latitude > 90) {
		return { ok: false, invalid: 'lat' };
	}
	const longitude = number(query, 'lon');
	if (longitude === undefined || longitude < -180 || longitude > 180) {
		return { ok: false, invalid: 'lon' };
	}
	const elevation = number(query, 'elevation');
	if (elevation === undefined || !Number.isInteger(elevation) || elevation <= 0) {
		return { ok: false, invalid: 'elevation' };
	}
	const camera = parseCamera(query);
	if ('invalid' in camera) {
		return { ok: false, invalid: camera.invalid };
	}
	// Only the Admin confirmation sends it, to say the camera is a proposal and not what is stored.
	const proposal = single(query, 'proposal');
	if (query.proposal !== undefined && (proposal !== '1' || !camera.value)) {
		return { ok: false, invalid: 'proposal' };
	}

	const target: SceneTarget = {
		slug: slug as string,
		name,
		latitude,
		longitude,
		elevationMeters: elevation
	};
	if (camera.value) {
		target.camera = camera.value;
	}

	const cameraOrigin: CameraOrigin = !camera.value ? 'none' : proposal ? 'proposed' : 'saved';

	return { ok: true, request: { mountainId: mountainId.toLowerCase(), target, cameraOrigin } };
}
