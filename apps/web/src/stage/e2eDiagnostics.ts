import type { CameraReading, ExposeCameraReading } from './globe/cameraReading';

type DiagnosticWindow = Window & { __serendipeakCamera?: () => CameraReading | undefined };

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
