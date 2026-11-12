import * as cesium from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CesiumModule } from './CesiumModule';
import { ViewerOrbit } from './ViewerOrbit';

const { Cartesian3, Ellipsoid } = cesium;

const PERIOD_SECONDS = 300;
const START = Cartesian3.fromDegrees(10, 20, 14_000_000);
const DIRECTION = Cartesian3.normalize(
	Cartesian3.negate(START, new Cartesian3()),
	new Cartesian3()
);
const UP = Cartesian3.UNIT_Z;

function setup(allowed = () => true) {
	const listeners = new Set<() => void>();
	const camera = {
		positionWC: Cartesian3.clone(START),
		directionWC: Cartesian3.clone(DIRECTION),
		upWC: Cartesian3.clone(UP),
		setView(options: {
			destination: cesium.Cartesian3;
			orientation: { direction: cesium.Cartesian3; up: cesium.Cartesian3 };
		}) {
			Cartesian3.clone(options.destination, camera.positionWC);
			Cartesian3.clone(options.orientation.direction, camera.directionWC);
			Cartesian3.clone(options.orientation.up, camera.upWC);
		}
	};
	const viewer = {
		camera,
		isDestroyed: () => false,
		scene: {
			ellipsoid: Ellipsoid.WGS84,
			preUpdate: {
				addEventListener(listener: () => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			}
		}
	};
	const orbit = new ViewerOrbit(cesium as unknown as CesiumModule, viewer as never, allowed);
	const frame = () => [...listeners].forEach((listener) => listener());
	const longitude = () =>
		(Ellipsoid.WGS84.cartesianToCartographic(camera.positionWC)!.longitude * 180) / Math.PI;

	return { orbit, camera, frame, longitude };
}

describe('ViewerOrbit.adopt', () => {
	let now = 0;

	beforeEach(() => {
		now = 1_000;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		vi.stubGlobal('document', { visibilityState: 'visible' });
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function turnFor(frame: () => void, seconds: number) {
		for (let step = 0; step < seconds * 10; step += 1) {
			now += 100;
			frame();
		}
	}

	it('keeps turning from a pose its owner moved to, where an unadopted move would halt it', () => {
		const halted = vi.fn();
		const { orbit, camera, frame, longitude } = setup();
		orbit.start(PERIOD_SECONDS, halted);
		turnFor(frame, 2);
		const before = longitude();

		const closer = Cartesian3.multiplyByScalar(camera.positionWC, 0.8, new Cartesian3());
		camera.setView({
			destination: closer,
			orientation: { direction: camera.directionWC, up: camera.upWC }
		});
		orbit.adopt();
		turnFor(frame, 2);

		expect(halted).not.toHaveBeenCalled();
		expect(orbit.running).toBe(true);
		expect(longitude()).toBeLessThan(before);
	});

	it('halts for the same move when it was not adopted', () => {
		const halted = vi.fn();
		const { orbit, camera, frame } = setup();
		orbit.start(PERIOD_SECONDS, halted);
		turnFor(frame, 1);

		const closer = Cartesian3.multiplyByScalar(camera.positionWC, 0.8, new Cartesian3());
		camera.setView({
			destination: closer,
			orientation: { direction: camera.directionWC, up: camera.upWC }
		});
		frame();

		expect(halted).toHaveBeenCalledOnce();
		expect(orbit.running).toBe(false);
	});

	it('does nothing when no orbit is running', () => {
		const { orbit } = setup();

		expect(() => orbit.adopt()).not.toThrow();
		expect(orbit.running).toBe(false);
	});
});
