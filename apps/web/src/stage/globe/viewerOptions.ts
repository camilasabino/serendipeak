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
	fullscreenButton: false
} as const;

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
