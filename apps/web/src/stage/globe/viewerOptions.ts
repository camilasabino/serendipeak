export const VIEWER_OPTIONS = {
	animation: false,
	baseLayerPicker: false,
	geocoder: false,
	timeline: false,
	homeButton: false,
	sceneModePicker: false,
	infoBox: false,
	selectionIndicator: false,
	navigationHelpButton: false,
	fullscreenButton: false,
	// Cesium's own panel prints the raw DeveloperError; the scene reports render failures instead.
	showRenderLoopErrors: false
} as const;

// With 4x MSAA, Chrome on an Adreno 830 drops the summit billboards for single frames while the
// camera moves away from them. One sample plus FXAA does not, and keeps the billboards' depth test
// against the terrain. Only this GPU was measured, so nothing broader matches.
const MSAA_FLICKER_RENDERER = /\bAdreno \(TM\) 830\b/;

interface RendererContext {
	getExtension(name: string): { UNMASKED_RENDERER_WEBGL: number } | null;
	getParameter(parameter: number): unknown;
}

interface AntialiasingTarget {
	msaaSamples: number;
	canvas: { getContext?(contextId: string): unknown };
	postProcessStages: { fxaa: { enabled: boolean } };
}

export function isMsaaFlickerRenderer(renderer: unknown): boolean {
	return typeof renderer === 'string' && MSAA_FLICKER_RENDERER.test(renderer);
}

function unmaskedRenderer(canvas: AntialiasingTarget['canvas']): unknown {
	// A canvas returns the context it already has for a type, so this creates none.
	const context = (canvas.getContext?.('webgl2') ?? canvas.getContext?.('webgl')) as
		RendererContext | null | undefined;
	const info = context?.getExtension('WEBGL_debug_renderer_info');

	return info ? context?.getParameter(info.UNMASKED_RENDERER_WEBGL) : undefined;
}

/**
 * Swaps MSAA for FXAA on the GPU that flickers with it. A renderer that is masked, unreadable or
 * anything else keeps Cesium's defaults. Run before the first frame; no Viewer rebuild is needed.
 */
export function avoidMsaaFlicker(scene: AntialiasingTarget): void {
	let renderer: unknown;
	try {
		renderer = unmaskedRenderer(scene.canvas);
	} catch {
		// Reading the renderer is only a hint; a context that refuses to answer keeps the defaults.
		return;
	}
	if (!isMsaaFlickerRenderer(renderer)) {
		return;
	}

	scene.msaaSamples = 1;
	scene.postProcessStages.fxaa.enabled = true;
}

interface CameraEventBinding {
	eventType: number;
	modifier?: number;
}

interface ZoomControllerTarget {
	zoomEventTypes: unknown;
}

interface ZoomEventEnums {
	CameraEventType: { WHEEL: number };
	KeyboardEventModifier: { CTRL: number };
}

// Chrome, Edge and Firefox report a trackpad pinch as a wheel event with the Ctrl modifier. Cesium
// already swallows that event on the canvas but binds zoom only to the unmodified wheel, so without
// this the pinch does nothing at all.
export function enableTrackpadPinchZoom(
	controller: ZoomControllerTarget,
	{ CameraEventType, KeyboardEventModifier }: ZoomEventEnums
): void {
	const current = controller.zoomEventTypes;
	const bindings: unknown[] = Array.isArray(current)
		? current
		: current === undefined
			? []
			: [current];
	const pinch: CameraEventBinding = {
		eventType: CameraEventType.WHEEL,
		modifier: KeyboardEventModifier.CTRL
	};
	const isPinch = (binding: unknown) => {
		const candidate = binding as Partial<CameraEventBinding> | null;
		return (
			typeof candidate === 'object' &&
			candidate?.eventType === pinch.eventType &&
			candidate.modifier === pinch.modifier
		);
	};
	if (!bindings.some(isPinch)) {
		controller.zoomEventTypes = [...bindings, pinch];
	}
}

interface EntityPickingTarget {
	screenSpaceEventHandler: { removeInputAction(type: number): void };
}

interface EntityPickingEventTypes {
	LEFT_CLICK: number;
	LEFT_DOUBLE_CLICK: number;
}

export function disableEntityPicking(
	viewer: EntityPickingTarget,
	eventTypes: EntityPickingEventTypes
): void {
	viewer.screenSpaceEventHandler.removeInputAction(eventTypes.LEFT_CLICK);
	viewer.screenSpaceEventHandler.removeInputAction(eventTypes.LEFT_DOUBLE_CLICK);
}
