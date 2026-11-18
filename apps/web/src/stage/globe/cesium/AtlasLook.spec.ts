import { describe, expect, it, vi } from 'vitest';
import { ATLAS_LOOK } from '../atlasLook';
import { AtlasLook, type LookScene } from './AtlasLook';

const GLOBAL = 16_000_000;
const MOUNTAIN = 90_000;
const FADE_MS = ATLAS_LOOK.fadeSeconds * 1000;

class FakeLayer {
	saturation = 1;
	brightness = 1;
	contrast = 1;
	destroyed = false;
	writes = 0;
	isDestroyed() {
		return this.destroyed;
	}
}

// Counts every write to the scene, so a test can tell an untouched scene from one rewritten with
// the value it already had.
function counted<T extends object>(target: T, onWrite: () => void): T {
	return new Proxy(target, {
		set(object, key, value) {
			onWrite();
			return Reflect.set(object, key, value);
		}
	});
}

function setup({ reduced = false, layers = 1 }: { reduced?: boolean; layers?: number } = {}) {
	let writes = 0;
	const onWrite = () => (writes += 1);
	const listeners = new Set<() => void>();
	const added = vi.fn();
	const removed = vi.fn();
	const camera = { positionCartographic: { height: GLOBAL } };
	const layer = new FakeLayer();
	const collection: FakeLayer[] = Array.from({ length: layers }, () => layer);
	const scene = {
		backgroundColor: counted({ red: 0, green: 0, blue: 0 }, onWrite),
		skyBox: counted({ show: true }, onWrite),
		sun: counted({ show: true }, onWrite),
		moon: counted({ show: true }, onWrite),
		skyAtmosphere: counted({ saturationShift: 0, brightnessShift: 0 }, onWrite),
		globe: counted({ atmosphereSaturationShift: 0, atmosphereBrightnessShift: 0 }, onWrite),
		imageryLayers: {
			get length() {
				return collection.length;
			},
			get: (index: number) => collection[index]!
		},
		camera,
		preRender: {
			addEventListener: (listener: () => void) => {
				listeners.add(listener);
				added();
				return () => {
					listeners.delete(listener);
					removed();
				};
			}
		}
	};
	// The base layer's own writes count too.
	collection.splice(0, collection.length, ...collection.map((entry) => counted(entry, onWrite)));
	let clock = 1000;
	const reducedMotion = { matches: reduced };
	const look = new AtlasLook(scene as unknown as LookScene, {
		reducedMotion: () => reducedMotion.matches,
		now: () => clock
	});

	return {
		scene,
		layer: collection[0] as FakeLayer | undefined,
		collection,
		camera,
		look,
		added,
		removed,
		reducedMotion,
		get listeners() {
			return listeners.size;
		},
		get writes() {
			return writes;
		},
		/** One rendered frame, `ms` after the last. */
		frame(ms = 16) {
			clock += ms;
			for (const listener of [...listeners]) {
				listener();
			}
		},
		/** Frames until the fade has surely finished. */
		finishFade() {
			for (let elapsed = 0; elapsed <= FADE_MS + 100; elapsed += 50) {
				this.frame(50);
			}
		}
	};
}

function expectOriginal(context: ReturnType<typeof setup>) {
	const { scene, layer } = context;
	expect(scene.backgroundColor).toEqual({ red: 0, green: 0, blue: 0 });
	expect(scene.skyBox.show).toBe(true);
	expect(scene.sun.show).toBe(true);
	expect(scene.moon.show).toBe(true);
	expect(scene.skyAtmosphere).toEqual({ saturationShift: 0, brightnessShift: 0 });
	expect(scene.globe).toEqual({ atmosphereSaturationShift: 0, atmosphereBrightnessShift: 0 });
	if (layer) {
		expect(layer).toMatchObject({ saturation: 1, brightness: 1, contrast: 1 });
	}
}

function expectFull(context: ReturnType<typeof setup>) {
	const { scene, layer } = context;
	const { background, skyAtmosphere, groundAtmosphere, layer: look } = ATLAS_LOOK;
	expect(scene.backgroundColor.red).toBeCloseTo(background.red, 10);
	expect(scene.backgroundColor.green).toBeCloseTo(background.green, 10);
	expect(scene.backgroundColor.blue).toBeCloseTo(background.blue, 10);
	expect(scene.skyBox.show).toBe(true);
	expect(scene.sun.show).toBe(false);
	expect(scene.moon.show).toBe(false);
	expect(scene.skyAtmosphere).toEqual(skyAtmosphere);
	expect(scene.globe.atmosphereSaturationShift).toBe(groundAtmosphere.saturationShift);
	expect(scene.globe.atmosphereBrightnessShift).toBe(groundAtmosphere.brightnessShift);
	expect(layer).toMatchObject(look);
}

describe('AtlasLook', () => {
	describe('a scene that is not the atlas', () => {
		it('is never written to, nor listened to, however far the camera is', () => {
			const context = setup();

			context.look.setActive(false);
			context.frame();

			expect(context.writes).toBe(0);
			expect(context.listeners).toBe(0);
			expect(context.look.read()?.intensity).toBe(0);
			expectOriginal(context);
		});

		it('keeps the globe look of the reveal, stars included', () => {
			const context = setup();
			context.camera.positionCartographic.height = GLOBAL;

			context.look.setActive(false);

			expect(context.scene.skyBox.show).toBe(true);
			expect(context.look.read()?.skyBoxShown).toBe(true);
		});
	});

	describe('entering the atlas', () => {
		it('places the full look at once the first time, behind the loader', () => {
			const context = setup();

			context.look.setActive(true);

			expectFull(context);
			expect(context.look.read()?.intensity).toBe(1);
		});

		it('fades in on later entries instead of flashing', () => {
			const context = setup();
			context.look.setActive(false);

			context.look.setActive(true);
			expectOriginal(context);

			context.frame();
			context.frame(FADE_MS / 2);
			const half = context.look.read()!.intensity;
			expect(half).toBeGreaterThan(0.3);
			expect(half).toBeLessThan(0.7);
			expect(context.layer!.saturation).toBeGreaterThan(ATLAS_LOOK.layer.saturation);
			expect(context.layer!.saturation).toBeLessThan(1);

			context.finishFade();
			expectFull(context);
		});

		it('is the atlas even with no markers, no layer and no imagery yet', () => {
			const context = setup({ layers: 0 });

			context.look.setActive(true);

			expect(context.look.read()?.intensity).toBe(1);
			expect(context.scene.skyBox.show).toBe(true);
		});
	});

	describe('altitude', () => {
		it('stays original at a mountain even while the atlas is presented', () => {
			const context = setup();
			context.camera.positionCartographic.height = MOUNTAIN;

			context.look.setActive(true);

			expectOriginal(context);
			expect(context.writes).toBe(0);
		});

		it('follows the camera down to the original and back up again', () => {
			const context = setup();
			context.look.setActive(true);

			const heights = [12_000_000, 4_000_000, 2_500_000, 1_500_000, 900_000];
			const intensities: number[] = [];
			for (const height of heights) {
				context.camera.positionCartographic.height = height;
				context.frame();
				intensities.push(context.look.read()!.intensity);
			}

			expect(intensities).toEqual([...intensities].sort((a, b) => b - a));
			expect(intensities[0]).toBe(1);
			expect(intensities.at(-1)).toBe(0);
			expectOriginal(context);

			context.camera.positionCartographic.height = GLOBAL;
			context.frame();
			expectFull(context);
		});

		it('blends the atmosphere, background and layer by the same strength', () => {
			const context = setup();
			context.camera.positionCartographic.height = Math.sqrt(
				ATLAS_LOOK.absentBelowMeters * ATLAS_LOOK.fullAboveMeters
			);

			context.look.setActive(true);

			expect(context.look.read()?.intensity).toBeCloseTo(0.5, 10);
			expect(context.layer!.saturation).toBeCloseTo(1 + (ATLAS_LOOK.layer.saturation - 1) / 2, 10);
			expect(context.layer!.contrast).toBeCloseTo(1 + (ATLAS_LOOK.layer.contrast - 1) / 2, 10);
			expect(context.scene.skyAtmosphere.brightnessShift).toBeCloseTo(
				ATLAS_LOOK.skyAtmosphere.brightnessShift / 2,
				10
			);
			expect(context.scene.backgroundColor.red).toBeCloseTo(ATLAS_LOOK.background.red / 2, 10);
		});
	});

	describe('leaving the atlas', () => {
		it('fades back to the original and then lets go of the frame listener', () => {
			const context = setup();
			context.look.setActive(true);

			context.look.setActive(false);
			context.frame();
			context.frame(FADE_MS / 2);
			expect(context.look.read()!.intensity).toBeGreaterThan(0);
			expect(context.look.read()!.intensity).toBeLessThan(1);
			expect(context.listeners).toBe(1);

			context.finishFade();

			expectOriginal(context);
			expect(context.look.read()).toMatchObject({ intensity: 0, listening: false });
			expect(context.listeners).toBe(0);
		});

		it('keeps the stars shown through every fade, so they never flash', () => {
			const context = setup();
			const shown: boolean[] = [];
			const observe = () => shown.push(context.scene.skyBox.show);
			context.look.setActive(true);
			observe();
			context.look.setActive(false);
			for (let elapsed = 0; elapsed <= FADE_MS + 100; elapsed += 50) {
				context.frame(50);
				observe();
			}
			context.look.setActive(true);
			for (let elapsed = 0; elapsed <= FADE_MS + 100; elapsed += 50) {
				context.frame(50);
				observe();
			}

			expect(shown.every(Boolean)).toBe(true);
		});

		it('restores values it found, not defaults it assumed', () => {
			const context = setup();
			context.scene.skyAtmosphere.saturationShift = 0.2;
			context.layer!.brightness = 1.3;
			context.layer!.saturation = 0.9;

			context.look.setActive(true);
			context.look.setActive(false);
			context.finishFade();

			expect(context.scene.skyAtmosphere.saturationShift).toBe(0.2);
			expect(context.layer).toMatchObject({ brightness: 1.3, saturation: 0.9, contrast: 1 });
		});

		it('restores at once under reduced motion, with no frame to wait for', () => {
			const context = setup({ reduced: true });
			context.look.setActive(true);
			expectFull(context);

			context.look.setActive(false);

			expectOriginal(context);
			expect(context.listeners).toBe(0);
		});
	});

	describe('reduced motion', () => {
		it('places the look without a fade when the atlas is entered later', () => {
			const context = setup({ reduced: true });
			context.look.setActive(false);

			context.look.setActive(true);

			expectFull(context);
			expect(context.look.read()?.intensity).toBe(1);
		});

		it('still lets the altitude decide how much of it shows', () => {
			const context = setup({ reduced: true });
			context.look.setActive(true);

			context.camera.positionCartographic.height = MOUNTAIN;
			context.frame();

			expectOriginal(context);
		});

		it('follows a change of preference at the next transition', () => {
			const context = setup();
			context.look.setActive(false);
			context.reducedMotion.matches = true;

			context.look.setActive(true);

			expectFull(context);
		});
	});

	describe('a missing, unready or removed imagery layer', () => {
		it('still applies the scene properties when there is no layer', () => {
			const context = setup({ layers: 0 });

			context.look.setActive(true);
			expect(context.scene.skyAtmosphere).toEqual(ATLAS_LOOK.skyAtmosphere);
			expect(context.look.read()?.layerSaturation).toBeUndefined();

			context.look.setActive(false);
			context.finishFade();
			expectOriginal(context);
		});

		it('skips a destroyed layer and does not write to it on restore', () => {
			const context = setup();
			context.look.setActive(true);
			const layer = context.layer!;
			context.collection.length = 0;
			layer.destroyed = true;
			const writes = context.writes;

			context.camera.positionCartographic.height = 8_000_000;
			context.look.setActive(false);
			context.finishFade();

			expect(context.look.read()?.layerSaturation).toBeUndefined();
			expect(context.scene.skyBox.show).toBe(true);
			expect(layer.saturation).toBe(ATLAS_LOOK.layer.saturation);
			expect(context.writes).toBeGreaterThan(writes);
		});

		it('captures a replacement layer by its own original values at the next change', () => {
			const context = setup();
			context.look.setActive(true);
			const replacement = new FakeLayer();
			replacement.saturation = 0.8;
			context.collection[0] = replacement;

			context.camera.positionCartographic.height = 4_000_000;
			context.frame();
			expect(replacement.saturation).toBeLessThan(0.8);

			context.look.setActive(false);
			context.finishFade();
			expect(replacement.saturation).toBe(0.8);
		});

		it('survives a scene built without a sky, a skybox, a sun, a moon or a globe', () => {
			const context = setup();
			const bare = context.scene as Partial<typeof context.scene>;
			delete bare.skyBox;
			delete bare.sun;
			delete bare.moon;
			delete bare.skyAtmosphere;
			delete bare.globe;

			context.look.setActive(true);
			context.look.setActive(false);
			context.finishFade();

			expect(context.layer).toMatchObject({ saturation: 1, brightness: 1, contrast: 1 });
			expect(context.scene.backgroundColor).toEqual({ red: 0, green: 0, blue: 0 });
		});
	});

	describe('repeated transitions', () => {
		it('returns to the very same original after many entries and exits, even interrupted', () => {
			const context = setup();
			context.look.setActive(false);

			for (let round = 0; round < 6; round += 1) {
				context.look.setActive(true);
				context.frame();
				context.frame(FADE_MS * (round % 2 === 0 ? 0.4 : 1.2));
				context.look.setActive(false);
				context.frame();
				context.frame(FADE_MS * (round % 3 === 0 ? 0.3 : 1.2));
			}
			context.look.setActive(false);
			context.finishFade();

			expectOriginal(context);
			expect(context.listeners).toBe(0);
		});

		it('registers at most one frame listener however often the atlas is toggled', () => {
			const context = setup();

			for (let round = 0; round < 5; round += 1) {
				context.look.setActive(true);
				context.look.setActive(false);
				context.look.setActive(true);
			}

			expect(context.listeners).toBe(1);
		});

		it('turns back mid-fade without a jump in strength', () => {
			const context = setup();
			context.look.setActive(false);
			context.look.setActive(true);
			context.frame();
			context.frame(FADE_MS / 2);
			const before = context.look.read()!.intensity;

			context.look.setActive(false);
			context.frame();

			expect(Math.abs(context.look.read()!.intensity - before)).toBeLessThan(0.05);
		});
	});

	describe('rendering cost', () => {
		it('stops writing once the look has settled and the camera is still', () => {
			const context = setup();
			context.look.setActive(true);
			const writes = context.writes;

			for (let index = 0; index < 20; index += 1) {
				context.frame();
			}

			expect(context.writes).toBe(writes);
			expect(context.listeners).toBe(1);
		});

		it('does not rewrite for a camera change too small to see', () => {
			const context = setup();
			context.camera.positionCartographic.height = 3_000_000;
			context.look.setActive(true);
			const writes = context.writes;

			context.camera.positionCartographic.height = 3_000_000 + 10;
			context.frame();

			expect(context.writes).toBe(writes);
		});

		it('removes its listener once and only when it is no longer needed', () => {
			const context = setup();
			context.look.setActive(true);
			context.look.setActive(false);
			expect(context.removed).not.toHaveBeenCalled();

			context.finishFade();
			context.finishFade();

			expect(context.removed).toHaveBeenCalledTimes(1);
			expect(context.added).toHaveBeenCalledTimes(1);
		});
	});

	describe('release', () => {
		it('removes the frame listener and ignores everything afterwards', () => {
			const context = setup();
			context.look.setActive(true);
			const writes = context.writes;

			context.look.release();
			context.look.release();
			context.look.setActive(false);
			context.camera.positionCartographic.height = MOUNTAIN;
			context.frame();

			expect(context.listeners).toBe(0);
			expect(context.removed).toHaveBeenCalledTimes(1);
			expect(context.writes).toBe(writes);
			expect(context.look.read()).toBeUndefined();
		});

		it('registers no listener when released before it was ever active', () => {
			const context = setup();

			context.look.release();
			context.look.setActive(true);

			expect(context.added).not.toHaveBeenCalled();
		});
	});
});
