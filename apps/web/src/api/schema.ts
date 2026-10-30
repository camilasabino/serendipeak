import type {
	CameraFraming,
	Coordinates,
	DailyMountain,
	Mountain,
	MountainCamera,
	MountainImage,
	MountainSources
} from './contract';

type JsonRecord = Record<string, unknown>;

// Mirrors services/api catalog/camera.py; the bounds belong to the frozen v1 contract.
const HEADING_MAX_EXCLUSIVE = 360;
const PITCH_MIN = -60;
const PITCH_MAX = 15;
const RANGE_MIN = 2_000;
const RANGE_MAX = 80_000;
const FRAMING_LIMIT = 1;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRecord(value: unknown): value is JsonRecord {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

function isNumberWithin(value: unknown, min: number, max: number): value is number {
	return isFiniteNumber(value) && value >= min && value <= max;
}

function isPositiveInteger(value: unknown): value is number {
	return Number.isInteger(value) && (value as number) > 0;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value !== '';
}

// Links end up in href and src; only web schemes are acceptable.
function isHttpUrl(value: unknown): value is string {
	if (!isNonEmptyString(value)) {
		return false;
	}
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

// The contract omits absent values: a key that is present must carry a valid value, never null.
function isOptional(
	record: JsonRecord,
	key: string,
	isValid: (value: unknown) => boolean
): boolean {
	return !(key in record) || isValid(record[key]);
}

function isCoordinates(value: unknown): value is Coordinates {
	return (
		isRecord(value) &&
		isNumberWithin(value.latitude, -90, 90) &&
		isNumberWithin(value.longitude, -180, 180)
	);
}

function isCameraFraming(value: unknown): value is CameraFraming {
	return (
		isRecord(value) &&
		isNumberWithin(value.x, -FRAMING_LIMIT, FRAMING_LIMIT) &&
		isNumberWithin(value.y, -FRAMING_LIMIT, FRAMING_LIMIT)
	);
}

function isMountainCamera(value: unknown): value is MountainCamera {
	return (
		isRecord(value) &&
		isFiniteNumber(value.headingDegrees) &&
		value.headingDegrees >= 0 &&
		value.headingDegrees < HEADING_MAX_EXCLUSIVE &&
		isNumberWithin(value.pitchDegrees, PITCH_MIN, PITCH_MAX) &&
		isNumberWithin(value.rangeMeters, RANGE_MIN, RANGE_MAX) &&
		isOptional(value, 'framing', isCameraFraming)
	);
}

function isMountainImage(value: unknown): value is MountainImage {
	return (
		isRecord(value) &&
		isHttpUrl(value.url) &&
		isNonEmptyString(value.attribution) &&
		isHttpUrl(value.sourcePageUrl) &&
		isNonEmptyString(value.sourceIdentifier) &&
		isOptional(value, 'thumbnailUrl', isHttpUrl) &&
		isOptional(value, 'width', isPositiveInteger) &&
		isOptional(value, 'height', isPositiveInteger) &&
		isOptional(value, 'creator', isNonEmptyString) &&
		isOptional(value, 'license', isNonEmptyString) &&
		isOptional(value, 'licenseUrl', isHttpUrl)
	);
}

function isMountainSources(value: unknown): value is MountainSources {
	return (
		isRecord(value) &&
		isOptional(value, 'osm', isHttpUrl) &&
		isOptional(value, 'wikidata', isHttpUrl) &&
		isOptional(value, 'wikipedia', isHttpUrl)
	);
}

export function isMountain(value: unknown): value is Mountain {
	return (
		isRecord(value) &&
		isNonEmptyString(value.id) &&
		isNonEmptyString(value.slug) &&
		isNonEmptyString(value.name) &&
		isCoordinates(value.coordinates) &&
		isPositiveInteger(value.elevationMeters) &&
		Array.isArray(value.countries) &&
		value.countries.every(isNonEmptyString) &&
		isOptional(value, 'prominenceMeters', Number.isInteger) &&
		isOptional(value, 'rangeName', isNonEmptyString) &&
		isOptional(value, 'summary', isNonEmptyString) &&
		isOptional(value, 'camera', isMountainCamera) &&
		isOptional(value, 'primaryImage', isMountainImage) &&
		isOptional(value, 'sources', isMountainSources)
	);
}

export function isCalendarDate(value: unknown): value is string {
	const match = typeof value === 'string' ? ISO_DATE.exec(value) : null;
	if (!match) {
		return false;
	}

	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
	const date = new Date(0);
	date.setUTCFullYear(year, month - 1, day);

	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

export function isDailyMountain(value: unknown): value is DailyMountain {
	return isRecord(value) && isCalendarDate(value.date) && isMountain(value.mountain);
}

export function hasErrorCode(body: unknown, code: string): boolean {
	return isRecord(body) && isRecord(body.error) && body.error.code === code;
}
