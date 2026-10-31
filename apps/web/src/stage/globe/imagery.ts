export const IMAGERY_MODES = ['sentinel2', 'world', 'none'] as const;

export type ImageryMode = (typeof IMAGERY_MODES)[number];

export const SENTINEL2_ASSET_ID = 3954;

export const PRODUCTION_IMAGERY_MODE: ImageryMode = 'world';

export class InvalidImageryModeError extends Error {
	constructor(value: string) {
		super(
			`NEXT_PUBLIC_CESIUM_IMAGERY_MODE must be one of ${IMAGERY_MODES.join(', ')}, received "${value}".`
		);
		this.name = 'InvalidImageryModeError';
	}
}

export function resolveImageryMode(isDevelopment: boolean, configured?: string): ImageryMode {
	const value = configured?.trim();

	if (!value) {
		return isDevelopment ? 'sentinel2' : PRODUCTION_IMAGERY_MODE;
	}

	const mode = IMAGERY_MODES.find((candidate) => candidate === value);

	if (!mode) {
		throw new InvalidImageryModeError(value);
	}

	return mode;
}

export interface ImageryStatus {
	label: string;
	note?: string;
}

export function imageryStatus(mode: ImageryMode): ImageryStatus {
	switch (mode) {
		case 'sentinel2':
			return { label: 'Imagery: Sentinel-2' };
		case 'none':
			return { label: 'Imagery: None' };
		case 'world':
			return {
				label: 'Imagery: Production',
				note: 'Production imagery · reloads may consume imagery sessions'
			};
	}
}

export interface BaseLayerSources<Layer> {
	sentinel2(): Layer;
	world(): Layer;
}

export function createBaseLayer<Layer>(
	mode: ImageryMode,
	sources: BaseLayerSources<Layer>
): Layer | false {
	switch (mode) {
		case 'sentinel2':
			return sources.sentinel2();
		case 'world':
			return sources.world();
		case 'none':
			return false;
	}
}
