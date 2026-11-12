export interface Coordinates {
	latitude: number;
	longitude: number;
}

export interface MountainImage {
	url: string;
	thumbnailUrl?: string;
	width?: number;
	height?: number;
	author: string;
	license?: string;
	licenseUrl?: string;
	sourcePageUrl?: string;
}

export interface MountainSources {
	osm?: string;
	wikidata?: string;
}

export interface CameraFraming {
	x: number;
	y: number;
}

export interface MountainCamera {
	headingDegrees: number;
	pitchDegrees: number;
	rangeMeters: number;
	framing?: CameraFraming;
}

export interface Continent {
	code: string;
	name: string;
}

export interface Country {
	code: string;
	name: string;
}

export interface RegionReference {
	slug: string;
	name: string;
}

export interface Region extends RegionReference {
	ancestors: RegionReference[];
}

export interface Mountain {
	id: string;
	slug: string;
	name: string;
	coordinates: Coordinates;
	elevationMeters: number;
	continent: Continent;
	countries: Country[];
	region: Region | null;
	summary?: string;
	camera?: MountainCamera;
	primaryImage?: MountainImage;
	sources?: MountainSources;
}

/** The part of a mountain that names and locates it, served for every active mountain at once. */
export interface MountainIndexEntry {
	slug: string;
	name: string;
	coordinates: Coordinates;
	elevationMeters: number;
	continent: Continent;
	countries: Country[];
	region: Region | null;
}

export interface DailyMountain {
	date: string;
	mountain: Mountain;
}

export type ApiError = { kind: 'api-error'; status: number };

export type Unreachable = { kind: 'unreachable' };

export type MountainResult =
	{ kind: 'found'; mountain: Mountain } | { kind: 'not-found' } | ApiError | Unreachable;

export type DailyMountainResult =
	| { kind: 'found'; daily: DailyMountain }
	| { kind: 'no-eligible-mountains' }
	| ApiError
	| Unreachable;

export type RandomMountainResult =
	| { kind: 'found'; mountain: Mountain }
	| { kind: 'no-eligible-mountains' }
	| ApiError
	| Unreachable;

export type MountainIndexResult =
	{ kind: 'found'; mountains: MountainIndexEntry[] } | ApiError | Unreachable;
