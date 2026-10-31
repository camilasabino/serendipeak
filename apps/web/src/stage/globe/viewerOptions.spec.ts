import { describe, it, expect, vi } from 'vitest';
import { VIEWER_OPTIONS, disableEntityPicking, stageViewerOptions } from './viewerOptions';

describe('VIEWER_OPTIONS', () => {
	it('removes the Home and scene mode controls', () => {
		expect(VIEWER_OPTIONS.homeButton).toBe(false);
		expect(VIEWER_OPTIONS.sceneModePicker).toBe(false);
	});

	it('keeps the navigation help and fullscreen controls', () => {
		const disabled = Object.entries(VIEWER_OPTIONS)
			.filter(([, value]) => value === false)
			.map(([name]) => name);

		expect(disabled).not.toContain('navigationHelpButton');
		expect(disabled).not.toContain('fullscreenButton');
	});

	it('keeps the navigation help closed until the user opens it', () => {
		expect(VIEWER_OPTIONS.navigationInstructionsInitiallyVisible).toBe(false);
		expect(VIEWER_OPTIONS).not.toHaveProperty('navigationHelpButton');
		expect(stageViewerOptions({} as HTMLElement).navigationInstructionsInitiallyVisible).toBe(
			false
		);
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

describe('stageViewerOptions', () => {
	it('targets the stage wrapper for fullscreen, not the document body', () => {
		const stage = { id: 'stage' } as unknown as HTMLElement;

		const options = stageViewerOptions(stage);

		expect(options.fullscreenElement).toBe(stage);
		expect(options.fullscreenElement).not.toBe(undefined);
	});

	it('keeps every existing viewer option and the default fullscreen and help controls', () => {
		const options = stageViewerOptions({} as HTMLElement);

		expect(options).toMatchObject(VIEWER_OPTIONS);
		expect(options).not.toHaveProperty('fullscreenButton');
		expect(options).not.toHaveProperty('navigationHelpButton');
		expect(options).not.toHaveProperty('creditContainer');
	});
});
