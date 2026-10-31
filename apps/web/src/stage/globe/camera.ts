import type { CameraFraming } from './framing';

export interface SceneCamera {
	headingDegrees: number;
	pitchDegrees: number;
	rangeMeters: number;
	framing?: CameraFraming;
}

export interface SceneTarget {
	slug: string;
	name: string;
	latitude: number;
	longitude: number;
	elevationMeters: number;
	camera?: SceneCamera;
}
