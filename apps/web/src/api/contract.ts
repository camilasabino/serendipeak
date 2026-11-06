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
	wikipedia?: string;
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

export interface Mountain {
	id: string;
	slug: string;
	name: string;
	coordinates: Coordinates;
	elevationMeters: number;
	prominenceMeters?: number;
	rangeName?: string;
	countries: string[];
	summary?: string;
	camera?: MountainCamera;
	primaryImage?: MountainImage;
	sources?: MountainSources;
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
