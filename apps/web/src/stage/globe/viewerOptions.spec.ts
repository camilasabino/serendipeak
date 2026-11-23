import { describe, it, expect, vi } from 'vitest';
import {
	VIEWER_OPTIONS,
	avoidMsaaFlicker,
	disableEntityPicking,
	enableTrackpadPinchZoom,
	isMsaaFlickerRenderer
} from './viewerOptions';

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

	it('keeps Cesium from drawing its technical render error panel', () => {
		expect(VIEWER_OPTIONS.showRenderLoopErrors).toBe(false);
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

describe('isMsaaFlickerRenderer', () => {
	it('matches the Adreno 830 as Chrome reports it through ANGLE', () => {
		expect(isMsaaFlickerRenderer('ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)')).toBe(true);
	});

	it.each([
		'ANGLE (Qualcomm, Adreno (TM) 740, OpenGL ES 3.2)',
		'ANGLE (Qualcomm, Adreno (TM) 8300, OpenGL ES 3.2)',
		'ANGLE (Qualcomm, Adreno (TM) 1830, OpenGL ES 3.2)',
		'ANGLE (Qualcomm, Adreno (TM) 830M, OpenGL ES 3.2)',
		'Adreno',
		'Qualcomm',
		'ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)',
		'ANGLE (ARM, Mali-G720-Immortalis MC12, OpenGL ES 3.2)',
		''
	])('does not match %j', (renderer) => {
		expect(isMsaaFlickerRenderer(renderer)).toBe(false);
	});

	it('does not match a value that is not text', () => {
		expect(isMsaaFlickerRenderer(undefined)).toBe(false);
		expect(isMsaaFlickerRenderer(null)).toBe(false);
		expect(isMsaaFlickerRenderer(830)).toBe(false);
	});
});

describe('avoidMsaaFlicker', () => {
	const UNMASKED_RENDERER_WEBGL = 0x9246;
	const adreno830 = 'ANGLE (Qualcomm, Adreno (TM) 830, OpenGL ES 3.2)';

	function sceneOn(canvas: { getContext?: (contextId: string) => unknown }) {
		return { msaaSamples: 4, canvas, postProcessStages: { fxaa: { enabled: false } } };
	}

	function context(renderer: unknown, extension = true) {
		return {
			getExtension: vi.fn((name: string) =>
				extension && name === 'WEBGL_debug_renderer_info' ? { UNMASKED_RENDERER_WEBGL } : null
			),
			getParameter: vi.fn((parameter: number) =>
				parameter === UNMASKED_RENDERER_WEBGL ? renderer : undefined
			)
		};
	}

	it('turns MSAA off and FXAA on for the Adreno 830', () => {
		const scene = sceneOn({ getContext: () => context(adreno830) });

		avoidMsaaFlicker(scene);

		expect(scene.msaaSamples).toBe(1);
		expect(scene.postProcessStages.fxaa.enabled).toBe(true);
	});

	it('keeps MSAA and FXAA as they were on any other renderer', () => {
		const scene = sceneOn({
			getContext: () =>
				context('ANGLE (Apple, ANGLE Metal Renderer: Apple M5, Unspecified Version)')
		});

		avoidMsaaFlicker(scene);

		expect(scene.msaaSamples).toBe(4);
		expect(scene.postProcessStages.fxaa.enabled).toBe(false);
	});

	it('keeps the defaults when the renderer is masked', () => {
		const scene = sceneOn({ getContext: () => context(undefined, false) });

		avoidMsaaFlicker(scene);

		expect(scene.msaaSamples).toBe(4);
		expect(scene.postProcessStages.fxaa.enabled).toBe(false);
	});

	it('keeps the defaults when the canvas has no context to ask', () => {
		const scene = sceneOn({ getContext: () => null });

		avoidMsaaFlicker(scene);

		expect(scene.msaaSamples).toBe(4);
		expect(scene.postProcessStages.fxaa.enabled).toBe(false);
	});

	it('keeps the defaults when the canvas cannot hand out a context at all', () => {
		const scene = sceneOn({});

		avoidMsaaFlicker(scene);

		expect(scene.msaaSamples).toBe(4);
		expect(scene.postProcessStages.fxaa.enabled).toBe(false);
	});

	it('keeps the defaults when reading the renderer throws', () => {
		const scene = sceneOn({
			getContext: () => {
				throw new Error('context lost');
			}
		});

		expect(() => avoidMsaaFlicker(scene)).not.toThrow();
		expect(scene.msaaSamples).toBe(4);
		expect(scene.postProcessStages.fxaa.enabled).toBe(false);
	});

	it('falls back to a WebGL 1 context when the canvas has no WebGL 2 one', () => {
		const requested: string[] = [];
		const scene = sceneOn({
			getContext: (contextId) => {
				requested.push(contextId);
				return contextId === 'webgl' ? context(adreno830) : null;
			}
		});

		avoidMsaaFlicker(scene);

		expect(requested).toEqual(['webgl2', 'webgl']);
		expect(scene.msaaSamples).toBe(1);
		expect(scene.postProcessStages.fxaa.enabled).toBe(true);
	});

	it('asks only for contexts the canvas may already hold, and for no other parameter than the renderer', () => {
		const adreno = context(adreno830);
		const scene = sceneOn({ getContext: () => adreno });

		avoidMsaaFlicker(scene);

		expect(adreno.getParameter).toHaveBeenCalledTimes(1);
		expect(adreno.getParameter).toHaveBeenCalledWith(UNMASKED_RENDERER_WEBGL);
	});
});
