import { formatElevation } from '../../formatElevation';
import type { SceneTarget } from './camera';

export interface SummitMarker {
	latitude: number;
	longitude: number;
	elevationMeters: number;
	label: string;
}

export interface SummitMarkerDisplay {
	show(marker: SummitMarker): void;
	hide(): void;
}

export const SUMMIT_MARKER_STYLE = {
	pointPixelSize: 8,
	labelFont: '600 14px system-ui, sans-serif',
	labelOffsetPixels: 12,
	maxDistanceMeters: 300_000
} as const;

export function planSummitMarker(target: SceneTarget): SummitMarker {
	const { name, latitude, longitude, elevationMeters } = target;

	return {
		latitude,
		longitude,
		elevationMeters,
		label: `${name}\n${formatElevation(elevationMeters)}`
	};
}
