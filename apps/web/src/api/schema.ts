import {
	isFramingInBounds,
	isHeadingInBounds,
	isPitchInBounds,
	isRangeInBounds
} from './cameraBounds';
import type {
	CameraFraming,
	Continent,
	Coordinates,
	Country,
	DailyMountain,
	Mountain,
	MountainCamera,
	MountainImage,
	MountainIndexEntry,
	MountainSources,
	Region,
	RegionReference
} from './contract';

type JsonRecord = Record<string, unknown>;

// Mirrors services/api catalog/slug.py. The backend serves `today` and `random` as stateful
// routes, so they are never valid mountain slugs even though they match the grammar.
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const RESERVED_SLUGS: ReadonlySet<string> = new Set(['today', 'random']);

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
		isFiniteNumber(value.x) &&
		isFramingInBounds(value.x) &&
		isFiniteNumber(value.y) &&
		isFramingInBounds(value.y)
	);
}

function isMountainCamera(value: unknown): value is MountainCamera {
	return (
		isRecord(value) &&
		isFiniteNumber(value.headingDegrees) &&
		isHeadingInBounds(value.headingDegrees) &&
		isFiniteNumber(value.pitchDegrees) &&
		isPitchInBounds(value.pitchDegrees) &&
		isFiniteNumber(value.rangeMeters) &&
		isRangeInBounds(value.rangeMeters) &&
		isOptional(value, 'framing', isCameraFraming)
	);
}

function isMountainImage(value: unknown): value is MountainImage {
	return (
		isRecord(value) &&
		isHttpUrl(value.url) &&
		isNonEmptyString(value.author) &&
		isOptional(value, 'sourcePageUrl', isHttpUrl) &&
		isOptional(value, 'thumbnailUrl', isHttpUrl) &&
		isOptional(value, 'width', isPositiveInteger) &&
		isOptional(value, 'height', isPositiveInteger) &&
		isOptional(value, 'license', isNonEmptyString) &&
		isOptional(value, 'licenseUrl', isHttpUrl)
	);
}

function isMountainSources(value: unknown): value is MountainSources {
	return (
		isRecord(value) &&
		isOptional(value, 'osm', isHttpUrl) &&
		isOptional(value, 'wikidata', isHttpUrl)
	);
}

const CONTINENT_CODES = new Set(['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA']);
const COUNTRY_CODE = /^[A-Z]{2}$/;

function isContinent(value: unknown): value is Continent {
	return (
		isRecord(value) &&
		typeof value.code === 'string' &&
		CONTINENT_CODES.has(value.code) &&
		isNonEmptyString(value.name)
	);
}

function isCountry(value: unknown): value is Country {
	return (
		isRecord(value) &&
		typeof value.code === 'string' &&
		COUNTRY_CODE.test(value.code) &&
		isNonEmptyString(value.name)
	);
}

function isRegionReference(value: unknown): value is RegionReference {
	return isRecord(value) && isValidSlug(value.slug) && isNonEmptyString(value.name);
}

function isRegion(value: unknown): value is Region {
	return (
		isRegionReference(value) &&
		isRecord(value) &&
		Array.isArray(value.ancestors) &&
		value.ancestors.every(isRegionReference)
	);
}

function areDistinctCountries(value: unknown): value is Country[] {
	return (
		Array.isArray(value) &&
		value.every(isCountry) &&
		new Set(value.map((country) => country.code)).size === value.length
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
		isContinent(value.continent) &&
		areDistinctCountries(value.countries) &&
		value.region !== undefined &&
		(value.region === null || isRegion(value.region)) &&
		isOptional(value, 'summary', isNonEmptyString) &&
		isOptional(value, 'camera', isMountainCamera) &&
		isOptional(value, 'primaryImage', isMountainImage) &&
		isOptional(value, 'sources', isMountainSources)
	);
}

function isMountainIndexEntry(value: unknown): value is MountainIndexEntry {
	return (
		isRecord(value) &&
		isValidSlug(value.slug) &&
		isNonEmptyString(value.name) &&
		isCoordinates(value.coordinates) &&
		isPositiveInteger(value.elevationMeters) &&
		isContinent(value.continent) &&
		areDistinctCountries(value.countries) &&
		(value.region === null || isRegion(value.region))
	);
}

// The slug keys each entry and builds its link, so a repeated one would make two results the same.
export function isMountainIndex(value: unknown): value is { mountains: MountainIndexEntry[] } {
	if (!isRecord(value) || !Array.isArray(value.mountains)) {
		return false;
	}
	const entries: unknown[] = value.mountains;

	return (
		entries.every(isMountainIndexEntry) &&
		new Set(entries.map((entry) => (entry as MountainIndexEntry).slug)).size === entries.length
	);
}

export function isValidSlug(value: unknown): value is string {
	return typeof value === 'string' && SLUG_PATTERN.test(value) && !RESERVED_SLUGS.has(value);
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
