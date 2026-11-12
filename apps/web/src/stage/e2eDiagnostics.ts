import type { AtlasLayerReading, ExposeAtlasLayer } from './globe/atlasMarkers';
import type {
	CameraReading,
	ExposeCameraReading,
	ExposeGlobePosition,
	GlobePosition
} from './globe/cameraReading';

type DiagnosticWindow = Window & {
	__serendipeakCamera?: () => CameraReading | undefined;
	__serendipeakGlobe?: () => GlobePosition | undefined;
	__serendipeakAtlas?: () => AtlasLayerReading | undefined;
};

// Reached only through a dynamic import behind NEXT_PUBLIC_E2E_DIAGNOSTICS, so production builds omit it.
export const exposeCameraReading: ExposeCameraReading = (read) => {
	const target = window as DiagnosticWindow;
	target.__serendipeakCamera = read;

	return () => {
		if (target.__serendipeakCamera === read) {
			delete target.__serendipeakCamera;
		}
	};
};

export const exposeGlobePosition: ExposeGlobePosition = (read) => {
	const target = window as DiagnosticWindow;
	target.__serendipeakGlobe = read;

	return () => {
		if (target.__serendipeakGlobe === read) {
			delete target.__serendipeakGlobe;
		}
	};
};

export const exposeAtlasLayer: ExposeAtlasLayer = (read) => {
	const target = window as DiagnosticWindow;
	target.__serendipeakAtlas = read;

	return () => {
		if (target.__serendipeakAtlas === read) {
			delete target.__serendipeakAtlas;
		}
	};
};
