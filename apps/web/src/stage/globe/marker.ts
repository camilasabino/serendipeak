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

/** The dark plate under every marker label, so names read over snow as well as over rock. */
export const MARKER_LABEL_PLATE = {
	// The stage colour, near black; Cesium cannot read the CSS variable.
	color: '#0b1219',
	alpha: 0.78,
	paddingPixels: { x: 7, y: 4 }
} as const;

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
