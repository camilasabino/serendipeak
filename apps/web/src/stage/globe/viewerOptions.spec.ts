import { describe, it, expect, vi } from 'vitest';
import { VIEWER_OPTIONS, disableEntityPicking, enableTrackpadPinchZoom } from './viewerOptions';

describe('VIEWER_OPTIONS', () => {
	it('removes the Home and scene mode controls', () => {
		expect(VIEWER_OPTIONS.homeButton).toBe(false);
		expect(VIEWER_OPTIONS.sceneModePicker).toBe(false);
	});

	it('hides every Cesium toolbar control, including the navigation help and fullscreen', () => {
		const toolbarControls = [
			'homeButton',
			'sceneModePicker',
			'baseLayerPicker',
			'geocoder',
			'navigationHelpButton',
			'fullscreenButton',
			'animation',
			'timeline'
		] as const;

		for (const control of toolbarControls) {
			expect(VIEWER_OPTIONS[control], control).toBe(false);
		}
	});

	it('leaves fullscreen to the stage controls', () => {
		expect(VIEWER_OPTIONS.fullscreenButton).toBe(false);
		expect(VIEWER_OPTIONS).not.toHaveProperty('fullscreenElement');
	});

	it('disables the entity info box and selection indicator', () => {
		expect(VIEWER_OPTIONS.infoBox).toBe(false);
		expect(VIEWER_OPTIONS.selectionIndicator).toBe(false);
	});

	it('keeps the controls that were already disabled', () => {
		expect(VIEWER_OPTIONS).toMatchObject({
			animation: false,
			baseLayerPicker: false,
			geocoder: false,
			timeline: false
		});
	});

	it('does not touch the credit display', () => {
		expect(VIEWER_OPTIONS).not.toHaveProperty('creditContainer');
		expect(VIEWER_OPTIONS).not.toHaveProperty('creditViewport');
	});
});

describe('disableEntityPicking', () => {
	const eventTypes = { LEFT_CLICK: 0, LEFT_DOUBLE_CLICK: 1, WHEEL: 2 };

	it('removes only the click and double click entity handlers', () => {
		const removeInputAction = vi.fn();

		disableEntityPicking({ screenSpaceEventHandler: { removeInputAction } }, eventTypes);

		expect(removeInputAction).toHaveBeenCalledTimes(2);
		expect(removeInputAction).toHaveBeenCalledWith(eventTypes.LEFT_CLICK);
		expect(removeInputAction).toHaveBeenCalledWith(eventTypes.LEFT_DOUBLE_CLICK);
	});
});

describe('enableTrackpadPinchZoom', () => {
	const enums = {
		CameraEventType: { WHEEL: 3, RIGHT_DRAG: 1, PINCH: 4 },
		KeyboardEventModifier: { CTRL: 1 }
	};
	const pinch = { eventType: 3, modifier: 1 };

	it('adds Ctrl+wheel to the default zoom bindings and keeps them', () => {
		const controller = { zoomEventTypes: [1, 3, 4] as unknown };

		enableTrackpadPinchZoom(controller, enums);

		expect(controller.zoomEventTypes).toEqual([1, 3, 4, pinch]);
	});

	it('wraps a single binding and is idempotent', () => {
		const controller = { zoomEventTypes: 3 as unknown };

		enableTrackpadPinchZoom(controller, enums);
		enableTrackpadPinchZoom(controller, enums);

		expect(controller.zoomEventTypes).toEqual([3, pinch]);
	});

	it('binds the pinch when zoom had no binding', () => {
		const controller = { zoomEventTypes: undefined as unknown };

		enableTrackpadPinchZoom(controller, enums);

		expect(controller.zoomEventTypes).toEqual([pinch]);
	});
});
