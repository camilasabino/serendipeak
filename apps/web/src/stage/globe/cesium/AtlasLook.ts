import {
	ATLAS_LOOK,
	advancePresentation,
	atlasLookIntensity,
	mix,
	type AtlasLookReading
} from '../atlasLook';

interface Shown {
	show: boolean;
}

interface Atmosphere {
	saturationShift: number;
	brightnessShift: number;
}

interface GroundAtmosphere {
	atmosphereSaturationShift: number;
	atmosphereBrightnessShift: number;
}

interface Rgb {
	red: number;
	green: number;
	blue: number;
}

interface LookLayer {
	saturation: number;
	brightness: number;
	contrast: number;
	isDestroyed(): boolean;
}

/** The parts of a Cesium scene the look touches. Parts a Viewer was built without are absent. */
export interface LookScene {
	backgroundColor: Rgb;
	readonly skyBox?: Readonly<Shown>;
	sun?: Shown;
	moon?: Shown;
	skyAtmosphere?: Atmosphere;
	globe?: GroundAtmosphere;
	imageryLayers: { readonly length: number; get(index: number): LookLayer };
	camera: { positionCartographic: { height: number } };
	preRender: { addEventListener(listener: () => void): () => void };
}

interface LookOptions {
	reducedMotion: () => boolean;
	now?: () => number;
}

interface Original {
	background: Rgb;
	sun: boolean | undefined;
	moon: boolean | undefined;
	sky: Atmosphere | undefined;
	ground: GroundAtmosphere | undefined;
	layer: { layer: LookLayer; saturation: number; brightness: number; contrast: number } | undefined;
}

/**
 * Wears the atlas look on a Cesium scene. It sets scene and base-layer properties only, so there
 * is no extra pass, tile or request, and nothing is drawn over the markers, labels or credit.
 *
 * Whether the atlas is presented is told to it explicitly; how much of the look the scene shows is
 * that presentation, eased over a fade, times what the camera's height allows. Every property it
 * changes is captured when the look first appears and put back exactly when it is gone, and a
 * scene that never wears it is never written to. A frame listener exists only while there is
 * something to follow: the atlas is presented or a fade is still running.
 */
export class AtlasLook {
	private readonly now: () => number;
	private target: 0 | 1 = 0;
	private presentation = 0;
	private configured = false;
	private applied = 0;
	private original: Original | undefined;
	private removeFrame: (() => void) | undefined;
	private lastFrameAt: number | undefined;
	private lastHeight = Number.NaN;
	private released = false;

	constructor(
		private readonly scene: LookScene,
		private readonly options: LookOptions
	) {
		this.now = options.now ?? (() => performance.now());
	}

	/**
	 * Presents the atlas, or anything else. The first call places the look at once, as a scene that
	 * has just been built is still behind its loader, and so does reduced motion; later changes fade.
	 */
	setActive(active: boolean): void {
		if (this.released) {
			return;
		}
		this.target = active ? 1 : 0;
		if (!this.configured || this.options.reducedMotion()) {
			this.presentation = this.target;
		}
		this.configured = true;
		this.lastHeight = Number.NaN;
		this.update(0);
		this.listenWhileNeeded();
	}

	read(): AtlasLookReading | undefined {
		if (this.released) {
			return undefined;
		}
		const { backgroundColor, skyBox, imageryLayers } = this.scene;
		const layer = imageryLayers.length > 0 ? imageryLayers.get(0) : undefined;

		return {
			intensity: this.applied,
			listening: this.removeFrame !== undefined,
			skyBoxShown: skyBox?.show,
			layerSaturation: layer && !layer.isDestroyed() ? layer.saturation : undefined,
			background: {
				red: backgroundColor.red,
				green: backgroundColor.green,
				blue: backgroundColor.blue
			}
		};
	}

	/** Stops following the scene. The scene is left as it is: its owner is about to destroy it. */
	release(): void {
		this.released = true;
		this.stopListening();
	}

	private listenWhileNeeded(): void {
		const settledAbsent = this.target === 0 && this.presentation === 0;
		if (settledAbsent) {
			this.stopListening();
			return;
		}
		if (!this.removeFrame) {
			this.lastFrameAt = undefined;
			this.removeFrame = this.scene.preRender.addEventListener(() => this.frame());
		}
	}

	private stopListening(): void {
		const remove = this.removeFrame;
		this.removeFrame = undefined;
		this.lastFrameAt = undefined;
		remove?.();
	}

	private frame(): void {
		const now = this.now();
		const elapsed = this.lastFrameAt === undefined ? 0 : (now - this.lastFrameAt) / 1000;
		this.lastFrameAt = now;
		this.update(elapsed);
		this.listenWhileNeeded();
	}

	private update(elapsedSeconds: number): void {
		const fading = this.presentation !== this.target;
		if (fading) {
			this.presentation = advancePresentation(this.presentation, this.target, elapsedSeconds);
		}
		// Once the fade is over only the camera can change the look, so a camera that has not
		// moved costs nothing.
		const height = this.scene.camera.positionCartographic.height;
		if (!fading && height === this.lastHeight) {
			return;
		}
		this.lastHeight = height;
		this.apply(atlasLookIntensity(this.presentation, height));
	}

	private apply(intensity: number): void {
		const settled = intensity === 0 || intensity === 1;
		if (
			intensity === this.applied ||
			(!settled && Math.abs(intensity - this.applied) < ATLAS_LOOK.minStep)
		) {
			return;
		}
		if (intensity === 0) {
			this.restore();
			return;
		}

		const original = (this.original ??= this.capture());
		this.write(original, intensity);
		this.applied = intensity;
	}

	private capture(): Original {
		const { backgroundColor, sun, moon, skyAtmosphere, globe } = this.scene;

		return {
			background: {
				red: backgroundColor.red,
				green: backgroundColor.green,
				blue: backgroundColor.blue
			},
			sun: sun?.show,
			moon: moon?.show,
			sky: skyAtmosphere && {
				saturationShift: skyAtmosphere.saturationShift,
				brightnessShift: skyAtmosphere.brightnessShift
			},
			ground: globe && {
				atmosphereSaturationShift: globe.atmosphereSaturationShift,
				atmosphereBrightnessShift: globe.atmosphereBrightnessShift
			},
			layer: undefined
		};
	}

	private write(original: Original, intensity: number): void {
		const { backgroundColor, sun, moon, skyAtmosphere, globe } = this.scene;
		const { background, skyAtmosphere: sky, groundAtmosphere: ground } = ATLAS_LOOK;

		backgroundColor.red = mix(original.background.red, background.red, intensity);
		backgroundColor.green = mix(original.background.green, background.green, intensity);
		backgroundColor.blue = mix(original.background.blue, background.blue, intensity);
		// Sun and moon have no opacity to fade: they are gone while any of the look is worn. The
		// skybox is left alone: the stars give the dark globe its context and never need to toggle.
		if (sun) sun.show = false;
		if (moon) moon.show = false;
		if (skyAtmosphere && original.sky) {
			skyAtmosphere.saturationShift = mix(
				original.sky.saturationShift,
				sky.saturationShift,
				intensity
			);
			skyAtmosphere.brightnessShift = mix(
				original.sky.brightnessShift,
				sky.brightnessShift,
				intensity
			);
		}
		if (globe && original.ground) {
			globe.atmosphereSaturationShift = mix(
				original.ground.atmosphereSaturationShift,
				ground.saturationShift,
				intensity
			);
			globe.atmosphereBrightnessShift = mix(
				original.ground.atmosphereBrightnessShift,
				ground.brightnessShift,
				intensity
			);
		}
		this.writeLayer(original, intensity);
	}

	// The base layer can be absent, still loading, or removed and destroyed after a failure, and a
	// replacement is a different object: each is captured the first time it is written.
	private writeLayer(original: Original, intensity: number): void {
		const { imageryLayers } = this.scene;
		const layer = imageryLayers.length > 0 ? imageryLayers.get(0) : undefined;
		if (original.layer && original.layer.layer !== layer) {
			this.restoreLayer(original);
		}
		if (!layer || layer.isDestroyed()) {
			return;
		}
		original.layer ??= {
			layer,
			saturation: layer.saturation,
			brightness: layer.brightness,
			contrast: layer.contrast
		};
		const { layer: look } = ATLAS_LOOK;
		layer.saturation = mix(original.layer.saturation, look.saturation, intensity);
		layer.brightness = mix(original.layer.brightness, look.brightness, intensity);
		layer.contrast = mix(original.layer.contrast, look.contrast, intensity);
	}

	private restore(): void {
		const original = this.original;
		this.original = undefined;
		this.applied = 0;
		if (!original) {
			return;
		}

		const { backgroundColor, sun, moon, skyAtmosphere, globe } = this.scene;
		backgroundColor.red = original.background.red;
		backgroundColor.green = original.background.green;
		backgroundColor.blue = original.background.blue;
		if (sun && original.sun !== undefined) sun.show = original.sun;
		if (moon && original.moon !== undefined) moon.show = original.moon;
		if (skyAtmosphere && original.sky) {
			skyAtmosphere.saturationShift = original.sky.saturationShift;
			skyAtmosphere.brightnessShift = original.sky.brightnessShift;
		}
		if (globe && original.ground) {
			globe.atmosphereSaturationShift = original.ground.atmosphereSaturationShift;
			globe.atmosphereBrightnessShift = original.ground.atmosphereBrightnessShift;
		}
		this.restoreLayer(original);
	}

	private restoreLayer(original: Original): void {
		const captured = original.layer;
		original.layer = undefined;
		if (!captured || captured.layer.isDestroyed()) {
			return;
		}
		captured.layer.saturation = captured.saturation;
		captured.layer.brightness = captured.brightness;
		captured.layer.contrast = captured.contrast;
	}
}
