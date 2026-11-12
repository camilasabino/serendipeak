import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SceneTarget } from './camera';
import {
	DIRECT_FLIGHT_SECONDS,
	RESET_FLIGHT_SECONDS,
	CameraDirector,
	lookFromOffset,
	type CameraFlight,
	type CameraGlide,
	type CameraMove,
	type CameraOutcome,
	type GlideCallbacks
} from './choreography';
import type { LookState } from './glidePath';
import type { SummitMarker, SummitMarkerDisplay } from './marker';
import type { CesiumCameraOffset } from './terrainCamera';
import type { MotionPreference } from './transitionPlan';

const OFFSET: CesiumCameraOffset = {
	headingRadians: Math.PI / 2,
	pitchRadians: (-22 * Math.PI) / 180,
	rollRadians: 0,
	rangeMeters: 9_200,
	framingX: 0,
	framingY: 0
};

const ACONCAGUA: SceneTarget = {
	slug: 'aconcagua',
	name: 'Aconcagua',
	latitude: -32.65,
	longitude: -70.01,
	elevationMeters: 6961
};

const FRAMED_OFFSET: CesiumCameraOffset = {
	headingRadians: (66.87 * Math.PI) / 180,
	pitchRadians: (-19.85 * Math.PI) / 180,
	rollRadians: 0,
	rangeMeters: 17_132,
	framingX: -0.0587,
	framingY: 0.3857
};

const POSITIVE_PITCH_OFFSET: CesiumCameraOffset = {
	headingRadians: (103.3 * Math.PI) / 180,
	pitchRadians: (1.39 * Math.PI) / 180,
	rollRadians: 0,
	rangeMeters: 14_828,
	framingX: 0.047,
	framingY: 0.4068
};

const EVEREST: SceneTarget = {
	slug: 'mount-everest',
	name: 'Mount Everest',
	latitude: 27.9881,
	longitude: 86.925,
	elevationMeters: 8849
};

const FUJI: SceneTarget = {
	slug: 'mount-fuji',
	name: 'Mount Fuji',
	latitude: 35.36,
	longitude: 138.73,
	elevationMeters: 3776
};

function createFakeFlight() {
	const moves: CameraMove[] = [];
	const glides: CameraGlide[] = [];
	const jumps: { target: SceneTarget; offset: CesiumCameraOffset }[] = [];
	let active: { onComplete: () => void; onCancel: () => void } | undefined;
	let activeGlide: GlideCallbacks | undefined;
	const staleGlides: GlideCallbacks[] = [];
	let throwOnFly: unknown;
	let throwOnJump: unknown;
	let throwOnGlide: unknown;
	let currentLook: LookState | undefined;
	const applied: LookState[] = [];
	const lookFlights: { look: LookState; durationSeconds: number }[] = [];
	let expressible = true;

	const flight: CameraFlight = {
		fly(move, { onComplete, onCancel }) {
			if (throwOnFly) {
				throw throwOnFly;
			}
			active = { onComplete, onCancel };
			moves.push(move);
		},
		glide(glide, callbacks) {
			if (throwOnGlide) {
				throw throwOnGlide;
			}
			activeGlide = callbacks;
			staleGlides.push(callbacks);
			glides.push(glide);
		},
		jump(target, offset) {
			if (throwOnJump) {
				throw throwOnJump;
			}
			jumps.push({ target, offset });
		},
		applyLook(look) {
			if (expressible) {
				applied.push(look);
			}
			return expressible;
		},
		flyToLook(look, durationSeconds, callbacks) {
			if (!expressible) {
				return false;
			}
			active = callbacks;
			lookFlights.push({ look, durationSeconds });
			return true;
		},
		look: () => currentLook,
		cancel: vi.fn(() => {
			const cancelled = active;
			active = undefined;
			cancelled?.onCancel();
			const cancelledGlide = activeGlide;
			activeGlide = undefined;
			cancelledGlide?.onCancel();
		})
	};

	return {
		flight,
		moves,
		glides,
		jumps,
		applied,
		lookFlights,
		cannotExpressLooks() {
			expressible = false;
		},
		complete() {
			const current = active;
			active = undefined;
			current?.onComplete();
		},
		userCancels() {
			const current = active;
			active = undefined;
			current?.onCancel();
		},
		approach() {
			activeGlide?.onApproach();
		},
		arrive() {
			const current = activeGlide;
			activeGlide = undefined;
			current?.onComplete();
		},
		failGlide(error: unknown) {
			activeGlide?.onFail(error);
		},
		lateCallbacks() {
			return staleGlides;
		},
		failNextFlight(error: unknown) {
			throwOnFly = error;
		},
		failNextJump(error: unknown) {
			throwOnJump = error;
		},
		failNextGlide(error: unknown) {
			throwOnGlide = error;
		},
		setLook(look: LookState | undefined) {
			currentLook = look;
		}
	};
}

function createMarkers() {
	const events: string[] = [];
	const shown: SummitMarker[] = [];
	const display: SummitMarkerDisplay = {
		show: vi.fn((marker) => {
			events.push(`show:${marker.label.split('\n')[0]}`);
			shown.push(marker);
		}),
		hide: vi.fn(() => {
			events.push('hide');
		})
	};
	return { display, events, shown };
}

describe('CameraDirector', () => {
	it('places the final offset immediately and shows the marker before settling', () => {
		const fake = createFakeFlight();
		const markers = createMarkers();
		const onSettled = vi.fn(() => markers.events.push('settled'));

		new CameraDirector(fake.flight, markers.display).place(ACONCAGUA, OFFSET, onSettled);

		expect(fake.moves).toEqual([]);
		expect(fake.jumps).toEqual([{ target: ACONCAGUA, offset: OFFSET }]);
		expect(markers.events).toEqual(['show:Aconcagua', 'settled']);
		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
		expect(OFFSET.headingRadians).toBeCloseTo(Math.PI / 2, 10);
	});

	it('does not touch the marker while reframing', () => {
		const fake = createFakeFlight();
		const markers = createMarkers();
		const director = new CameraDirector(fake.flight, markers.display, {
			cameraHeight: () => 8_000
		});
		const onSettled = vi.fn();

		expect(director.reframe(ACONCAGUA, OFFSET, false, onSettled)).toBe(true);
		expect(fake.moves).toEqual([]);
		expect(fake.jumps).toEqual([{ target: ACONCAGUA, offset: OFFSET }]);
		expect(markers.events).toEqual([]);
		expect(onSettled).toHaveBeenCalledOnce();

		expect(director.reframe(ACONCAGUA, { ...OFFSET, rangeMeters: 11_000 }, true)).toBe(true);
		expect(fake.moves).toHaveLength(1);
		expect(fake.moves[0]!.durationSeconds).toBe(DIRECT_FLIGHT_SECONDS);
		expect(markers.display.show).not.toHaveBeenCalled();
		expect(director.busy()).toBe(true);

		fake.complete();

		expect(director.busy()).toBe(false);
		expect(markers.display.show).not.toHaveBeenCalled();
	});

	it('jumps a reduced-motion reframe', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);

		director.reframe(FUJI, OFFSET, false);

		expect(fake.moves).toEqual([]);
		expect(fake.jumps[0]!.target).toEqual(FUJI);
	});

	it('reports a failed placement without a marker', () => {
		const fake = createFakeFlight();
		const markers = createMarkers();
		const failure = new Error('camera is morphing');
		fake.failNextJump(failure);
		const onSettled = vi.fn();

		new CameraDirector(fake.flight, markers.display).place(ACONCAGUA, OFFSET, onSettled);

		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'failed', error: failure });
		expect(markers.display.show).not.toHaveBeenCalled();
	});

	it('hides the marker on stop and settles the glide that was running', () => {
		const fake = createFakeFlight();
		const markers = createMarkers();
		const onSettled = vi.fn<(outcome: CameraOutcome) => void>();
		const director = new CameraDirector(fake.flight, markers.display);
		director.travel(ACONCAGUA, OFFSET, 'reveal', onSettled);

		director.stop();

		expect(fake.flight.cancel).toHaveBeenCalledOnce();
		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'interrupted' });
		expect(markers.events.at(-1)).toBe('hide');
		expect(markers.display.show).not.toHaveBeenCalled();
	});

	it('ignores a second travel to the mountain already on screen', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		director.place(ACONCAGUA, OFFSET);
		director.travel(ACONCAGUA, OFFSET, 'explore');

		expect(fake.glides).toEqual([]);
		expect(fake.jumps).toHaveLength(1);
	});
});

describe('CameraDirector travel', () => {
	function director(motion: MotionPreference = 'full') {
		const fake = createFakeFlight();
		const markers = createMarkers();
		return {
			fake,
			markers,
			director: new CameraDirector(fake.flight, markers.display, { motion: () => motion })
		};
	}

	it('plans the globe reveal toward the final curated offset without jumping', () => {
		const { fake, markers, director: camera } = director();
		const onSettled = vi.fn();

		camera.travel(ACONCAGUA, FRAMED_OFFSET, 'reveal', onSettled);

		expect(fake.jumps).toEqual([]);
		expect(fake.moves).toEqual([]);
		expect(fake.glides).toHaveLength(1);
		const [glide] = fake.glides;
		expect(glide!.offset).toBe(FRAMED_OFFSET);
		expect(glide!.target).toBe(ACONCAGUA);
		expect(glide!.plan.journey).toBe('reveal');
		expect(glide!.plan.to).toEqual(lookFromOffset(ACONCAGUA, FRAMED_OFFSET));
		expect(glide!.plan.phases.map((phase) => phase.name)).toEqual(['context', 'approach']);
		expect(markers.events).toEqual(['hide']);
		expect(onSettled).not.toHaveBeenCalled();
	});

	it('keeps the marker hidden through the context phase and shows it once on approach', () => {
		const { fake, markers, director: camera } = director();
		const onSettled = vi.fn();
		camera.travel(ACONCAGUA, OFFSET, 'reveal', onSettled);

		expect(markers.display.show).not.toHaveBeenCalled();

		fake.approach();
		expect(markers.events).toEqual(['hide', 'show:Aconcagua']);
		expect(onSettled).not.toHaveBeenCalled();

		fake.approach();
		fake.arrive();

		expect(markers.events).toEqual(['hide', 'show:Aconcagua']);
		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
		expect(camera.busy()).toBe(false);
	});

	it('shows the marker at arrival when the approach callback never fired', () => {
		const { fake, markers, director: camera } = director();
		camera.travel(ACONCAGUA, OFFSET, 'reveal');

		fake.arrive();

		expect(markers.events).toEqual(['hide', 'show:Aconcagua']);
	});

	it('places the final offset directly when motion is reduced', () => {
		const { fake, markers, director: camera } = director('direct');
		const onSettled = vi.fn();

		camera.travel(ACONCAGUA, FRAMED_OFFSET, 'reveal', onSettled);

		expect(fake.glides).toEqual([]);
		expect(fake.jumps).toEqual([{ target: ACONCAGUA, offset: FRAMED_OFFSET }]);
		expect(markers.events).toEqual(['show:Aconcagua']);
		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
	});

	it('places directly on explore when motion is reduced', () => {
		const { fake, director: camera } = director('direct');
		fake.setLook(lookFromOffset(ACONCAGUA, OFFSET));

		camera.travel(FUJI, OFFSET, 'explore');

		expect(fake.glides).toEqual([]);
		expect(fake.jumps).toEqual([{ target: FUJI, offset: OFFSET }]);
	});

	it('places directly on explore when no origin view is known', () => {
		const { fake, director: camera } = director();

		camera.travel(FUJI, OFFSET, 'explore');

		expect(fake.glides).toEqual([]);
		expect(fake.jumps).toEqual([{ target: FUJI, offset: OFFSET }]);
	});

	it('glides from the live origin view with a distance-aware plan', () => {
		const { fake, markers, director: camera } = director();
		const origin = lookFromOffset(ACONCAGUA, OFFSET);
		fake.setLook(origin);
		const onSettled = vi.fn();

		camera.travel(FUJI, POSITIVE_PITCH_OFFSET, 'explore', onSettled);

		expect(fake.jumps).toEqual([]);
		const [glide] = fake.glides;
		expect(glide!.plan.journey).toBe('explore');
		expect(glide!.plan.transitionClass).toBe('intercontinental');
		expect(glide!.plan.from).toEqual(origin);
		expect(glide!.plan.to.pitchDegrees).toBeGreaterThan(0);
		expect(glide!.offset).toBe(POSITIVE_PITCH_OFFSET);
		expect(markers.events).toEqual(['hide']);

		fake.approach();
		fake.arrive();

		expect(markers.events).toEqual(['hide', 'show:Mount Fuji']);
		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
	});

	it('settles on the latest destination during rapid explores', () => {
		const { fake, markers, director: camera } = director();
		fake.setLook(lookFromOffset(ACONCAGUA, OFFSET));
		const first = vi.fn();
		const second = vi.fn();
		const third = vi.fn();

		camera.travel(FUJI, OFFSET, 'explore', first);
		fake.approach();
		camera.travel(EVEREST, OFFSET, 'explore', second);
		camera.travel(ACONCAGUA, OFFSET, 'explore', third);
		const [staleFirst, staleSecond] = fake.lateCallbacks();
		staleFirst!.onApproach();
		staleFirst!.onComplete();
		staleSecond!.onApproach();
		staleSecond!.onComplete();

		expect(markers.events.filter((event) => event.startsWith('show'))).toEqual(['show:Mount Fuji']);
		expect(markers.events.at(-1)).toBe('hide');
		expect(first).toHaveBeenCalledExactlyOnceWith({ status: 'interrupted' });
		expect(second).toHaveBeenCalledExactlyOnceWith({ status: 'interrupted' });
		expect(third).not.toHaveBeenCalled();

		fake.approach();
		fake.arrive();

		expect(third).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
		expect(markers.shown.map((marker) => marker.label.split('\n')[0])).toEqual([
			'Mount Fuji',
			'Aconcagua'
		]);
		expect(camera.busy()).toBe(false);
		expect(fake.jumps).toEqual([]);
	});

	it('joins a second request for the destination already being approached', () => {
		const { fake, director: camera } = director();
		const first = vi.fn();
		const second = vi.fn();

		camera.travel(ACONCAGUA, OFFSET, 'reveal', first);
		camera.travel(ACONCAGUA, OFFSET, 'reveal', second);
		fake.arrive();

		expect(fake.glides).toHaveLength(1);
		expect(first).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
		expect(second).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
	});

	it('reports an interrupted glide without a marker', () => {
		const { fake, markers, director: camera } = director();
		const onSettled = vi.fn();
		camera.travel(ACONCAGUA, OFFSET, 'reveal', onSettled);

		fake.flight.cancel();

		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'interrupted' });
		expect(markers.display.show).not.toHaveBeenCalled();
		expect(camera.busy()).toBe(false);
	});

	it('recovers on the final offset and reports a glide failure', () => {
		const { fake, markers, director: camera } = director();
		const onSettled = vi.fn();
		const failure = new Error('frame failed');
		camera.travel(ACONCAGUA, OFFSET, 'reveal', onSettled);

		fake.failGlide(failure);

		expect(fake.jumps).toEqual([{ target: ACONCAGUA, offset: OFFSET }]);
		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'failed', error: failure });
		expect(markers.display.show).not.toHaveBeenCalled();
		expect(camera.busy()).toBe(false);
	});

	it('reports a glide that cannot start', () => {
		const { fake, director: camera } = director();
		const failure = new Error('no frustum');
		fake.failNextGlide(failure);
		const onSettled = vi.fn();

		camera.travel(ACONCAGUA, OFFSET, 'reveal', onSettled);

		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'failed', error: failure });
		expect(camera.busy()).toBe(false);
	});

	it('blocks structural reframes while gliding', () => {
		const { fake, director: camera } = director();
		camera.travel(ACONCAGUA, OFFSET, 'reveal');

		expect(camera.busy()).toBe(true);
		expect(camera.reframe(ACONCAGUA, OFFSET, false)).toBe(false);

		fake.arrive();

		expect(camera.busy()).toBe(false);
	});
});

describe('superseding reframe', () => {
	const SUPERSEDE = { supersede: true, durationSeconds: RESET_FLIGHT_SECONDS };

	it('flies a short restrained move that is shorter than the structural reframe', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display, {
			cameraHeight: () => 8_000
		});

		expect(director.reframe(ACONCAGUA, OFFSET, true, undefined, SUPERSEDE)).toBe(true);

		expect(fake.moves).toHaveLength(1);
		expect(fake.moves[0]!.durationSeconds).toBe(RESET_FLIGHT_SECONDS);
		expect(RESET_FLIGHT_SECONDS).toBeLessThan(DIRECT_FLIGHT_SECONDS);
		expect(fake.moves[0]!.maximumHeightMeters).toBe(8_000);
	});

	it('jumps without a flight when motion is not animated', () => {
		const fake = createFakeFlight();
		const markers = createMarkers();
		const director = new CameraDirector(fake.flight, markers.display);
		const onSettled = vi.fn();

		expect(director.reframe(ACONCAGUA, OFFSET, false, onSettled, SUPERSEDE)).toBe(true);

		expect(fake.moves).toEqual([]);
		expect(fake.jumps).toEqual([{ target: ACONCAGUA, offset: OFFSET }]);
		expect(markers.events).toEqual([]);
		expect(onSettled).toHaveBeenCalledOnce();
		expect(director.busy()).toBe(false);
	});

	it('cancels a running reframe flight and starts the new one', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		const first = vi.fn();
		const second = vi.fn();
		director.reframe(ACONCAGUA, OFFSET, true, first);

		expect(director.reframe(ACONCAGUA, FRAMED_OFFSET, true, second, SUPERSEDE)).toBe(true);

		expect(fake.flight.cancel).toHaveBeenCalledOnce();
		expect(fake.moves).toHaveLength(2);
		expect(fake.moves[1]!.offset).toBe(FRAMED_OFFSET);
		expect(director.busy()).toBe(true);

		fake.complete();

		expect(first).not.toHaveBeenCalled();
		expect(second).toHaveBeenCalledOnce();
		expect(director.busy()).toBe(false);
	});

	it('does not supersede a plain reframe', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		director.reframe(ACONCAGUA, OFFSET, true);

		expect(director.reframe(ACONCAGUA, FRAMED_OFFSET, true)).toBe(false);
		expect(fake.moves).toHaveLength(1);
	});

	it('never interrupts a geographic route', () => {
		const fake = createFakeFlight();
		const markers = createMarkers();
		const director = new CameraDirector(fake.flight, markers.display);
		const onSettled = vi.fn();
		director.travel(ACONCAGUA, OFFSET, 'reveal', onSettled);

		expect(director.reframe(ACONCAGUA, OFFSET, true, undefined, SUPERSEDE)).toBe(false);
		expect(director.reframe(ACONCAGUA, OFFSET, false, undefined, SUPERSEDE)).toBe(false);

		expect(fake.flight.cancel).not.toHaveBeenCalled();
		expect(onSettled).not.toHaveBeenCalled();
		expect(director.busy()).toBe(true);

		fake.arrive();

		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
	});

	it('leaves no stuck state when the user takes over the flight', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		director.reframe(ACONCAGUA, OFFSET, true, undefined, SUPERSEDE);

		fake.userCancels();

		expect(director.busy()).toBe(false);
		expect(director.reframe(ACONCAGUA, OFFSET, true, undefined, SUPERSEDE)).toBe(true);
	});

	it('refuses after the director stopped', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		director.stop();

		expect(director.reframe(ACONCAGUA, OFFSET, false, undefined, SUPERSEDE)).toBe(false);
		expect(fake.jumps).toEqual([]);
	});
});

describe('production camera path', () => {
	const ADAPTER_DIRECTORY = new URL('./cesium/', import.meta.url);
	const adapterFiles = readdirSync(ADAPTER_DIRECTORY).filter(
		(name) => name.endsWith('.ts') && !name.endsWith('.spec.ts')
	);
	const files = [
		'./choreography.ts',
		'./mountainCamera.ts',
		'./camera.ts',
		'./transitionPlan.ts',
		'./glidePath.ts',
		...adapterFiles.map((name) => `./cesium/${name}`)
	];

	it('scans the real Cesium adapter files', () => {
		expect(adapterFiles).toEqual(
			expect.arrayContaining(['CesiumGlobeScene.ts', 'ViewerCameraFlight.ts', 'SummitMarkers.ts'])
		);
	});

	it('drives the camera through the shared director, plan and terrain modules', () => {
		const scene = readFileSync(new URL('./cesium/CesiumGlobeScene.ts', import.meta.url), 'utf8');
		const flight = readFileSync(new URL('./cesium/ViewerCameraFlight.ts', import.meta.url), 'utf8');

		expect(scene).toContain("from '../choreography'");
		expect(scene).toContain("from '../mountainCamera'");
		expect(scene).toContain("from '../terrainCamera'");
		expect(scene).toContain("from '../transitionPlan'");
		expect(flight).toContain("from '../glidePath'");
		expect(flight).toContain("from '../framing'");
	});

	it('does not keep the regional three-stage plan', () => {
		for (const file of files) {
			const source = readFileSync(new URL(file, import.meta.url), 'utf8');
			expect(source, file).not.toContain('planMountainCamera');
			expect(source, file).not.toContain('1_500_000');
			expect(source, file).not.toContain("name: 'regional'");
			expect(source, file).not.toContain('enableLighting');
			expect(source, file).not.toContain('fullscreenElement');
		}
	});
});

const OVERVIEW: LookState = {
	latitude: 10,
	longitude: 20,
	altitudeMeters: 0,
	headingDegrees: 0,
	pitchDegrees: -89,
	rangeMeters: 16_000_000,
	framingX: 0,
	framingY: 0
};

describe('CameraDirector free looks', () => {
	it('places a look at once with a zero duration, hiding the summit marker first', () => {
		const fake = createFakeFlight();
		const markers = createMarkers();
		const director = new CameraDirector(fake.flight, markers.display);
		director.place(ACONCAGUA, OFFSET);
		const onSettled = vi.fn();

		director.view(OVERVIEW, 0, onSettled);

		expect(fake.applied).toEqual([OVERVIEW]);
		expect(markers.events).toEqual(['show:Aconcagua', 'hide']);
		expect(onSettled).toHaveBeenCalledWith({ status: 'arrived' });
		expect(director.busy()).toBe(false);
	});

	it('flies to a look as a run that keeps the director busy until it completes', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		const onSettled = vi.fn();

		director.view(OVERVIEW, RESET_FLIGHT_SECONDS, onSettled);

		expect(fake.lookFlights).toEqual([{ look: OVERVIEW, durationSeconds: RESET_FLIGHT_SECONDS }]);
		expect(director.busy()).toBe(true);
		fake.complete();
		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'arrived' });
		expect(director.busy()).toBe(false);
	});

	it('reports a look flight that a mountain journey superseded as interrupted, once', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		const onSettled = vi.fn();
		director.view(OVERVIEW, RESET_FLIGHT_SECONDS, onSettled);

		director.place(ACONCAGUA, OFFSET);

		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'interrupted' });
		expect(fake.jumps).toHaveLength(1);
	});

	it('reports a look the view cannot express as a failure, without a run', () => {
		const fake = createFakeFlight();
		fake.cannotExpressLooks();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		const placed = vi.fn();
		const flown = vi.fn();

		director.view(OVERVIEW, 0, placed);
		director.view(OVERVIEW, RESET_FLIGHT_SECONDS, flown);

		expect(placed.mock.calls[0]?.[0]).toMatchObject({ status: 'failed' });
		expect(flown.mock.calls[0]?.[0]).toMatchObject({ status: 'failed' });
		expect(director.busy()).toBe(false);
	});

	it('does not reframe over a look flight, which no reframe may supersede', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		director.view(OVERVIEW, RESET_FLIGHT_SECONDS);

		expect(director.reframe(ACONCAGUA, OFFSET, true, undefined, { supersede: true })).toBe(false);
	});

	it('refuses looks once stopped', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		director.stop();
		const onSettled = vi.fn();

		director.view(OVERVIEW, 0, onSettled);

		expect(onSettled).toHaveBeenCalledWith({ status: 'interrupted' });
		expect(fake.applied).toEqual([]);
	});
});

describe('CameraDirector release', () => {
	it('cancels the journey, hides the marker and forgets the settled mountain, but keeps working', () => {
		const fake = createFakeFlight();
		fake.setLook(lookFromOffset(EVEREST, OFFSET));
		const markers = createMarkers();
		const director = new CameraDirector(fake.flight, markers.display);
		const onSettled = vi.fn();
		director.travel(ACONCAGUA, OFFSET, 'explore', onSettled);
		fake.approach();

		director.release();

		expect(onSettled).toHaveBeenCalledExactlyOnceWith({ status: 'interrupted' });
		expect(markers.events.at(-1)).toBe('hide');
		expect(director.busy()).toBe(false);

		const again = vi.fn();
		director.place(ACONCAGUA, OFFSET, again);
		expect(fake.jumps).toHaveLength(1);
		expect(again).toHaveBeenCalledWith({ status: 'arrived' });
	});

	it('makes a settled mountain travel again instead of counting as arrived', () => {
		const fake = createFakeFlight();
		const director = new CameraDirector(fake.flight, createMarkers().display);
		director.place(ACONCAGUA, OFFSET);

		director.release();
		director.place(ACONCAGUA, OFFSET);

		expect(fake.jumps).toHaveLength(2);
	});
});
