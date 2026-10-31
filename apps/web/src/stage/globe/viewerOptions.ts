export const VIEWER_OPTIONS = {
	animation: false,
	baseLayerPicker: false,
	geocoder: false,
	timeline: false,
	homeButton: false,
	sceneModePicker: false,
	infoBox: false,
	selectionIndicator: false,
	navigationInstructionsInitiallyVisible: false
} as const;

export function stageViewerOptions(stage: HTMLElement) {
	return { ...VIEWER_OPTIONS, fullscreenElement: stage };
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
