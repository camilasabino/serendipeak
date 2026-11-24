import * as cesium from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOUNTAIN_ORBIT_PERIOD_SECONDS } from '../mountainOrbit';
import type { CesiumModule } from './CesiumModule';
import { ViewerSummitOrbit } from './ViewerSummitOrbit';

const { Cartesian3, Cartographic, Ellipsoid, Matrix4, Transforms } = cesium;

const SUMMIT = { latitude: -32.653, longitude: -70.011, elevationMeters: 6961 };
const PIVOT = Cartesian3.fromDegrees(SUMMIT.longitude, SUMMIT.latitude, SUMMIT.elevationMeters);
const ENU = Transforms.eastNorthUpToFixedFrame(PIVOT);
const FROM_ENU = Matrix4.inverse(ENU, new Matrix4());
const RANGE_METERS = 12_000;
const DEGREES = Math.PI / 180;
const FRAME_MS = 1000 / 60;
// The chord one 60 Hz frame sweeps on the circle the camera rides around the summit.
const ONE_FRAME_METERS =
	2 *
	RANGE_METERS *
	Math.cos(18 * DEGREES) *
	Math.sin((Math.PI * (FRAME_MS / 1000)) / MOUNTAIN_ORBIT_PERIOD_SECONDS);

// A curated-style pose: looking at the summit from a heading and pitch, then turned a little so the
// summit sits off the centre of the view, as a framed pose leaves it.
function curatedPose(headingDegrees = 66.87, pitchDegrees = -18, offCentreDegrees = 3) {
	const heading = headingDegrees * DEGREES;
	const pitch = pitchDegrees * DEGREES;
	const toSummit = new Cartesian3(
		Math.sin(heading) * Math.cos(pitch),
		Math.cos(heading) * Math.cos(pitch),
		Math.sin(pitch)
	);
	const up = new Cartesian3(
		-Math.sin(heading) * Math.sin(pitch),
		-Math.cos(heading) * Math.sin(pitch),
		Math.cos(pitch)
	);
	const position = Matrix4.multiplyByPoint(
		ENU,
		Cartesian3.multiplyByScalar(toSummit, -RANGE_METERS, new Cartesian3()),
		new Cartesian3()
	);
	const turn = cesium.Matrix3.fromQuaternion(
		cesium.Quaternion.fromAxisAngle(up, offCentreDegrees * DEGREES)
	);
	const direction = Matrix4.multiplyByPointAsVector(
		ENU,
		cesium.Matrix3.multiplyByVector(turn, toSummit, new Cartesian3()),
		new Cartesian3()
	);
	const upWorld = Matrix4.multiplyByPointAsVector(ENU, up, new Cartesian3());

	return {
		position,
		direction: Cartesian3.normalize(direction, direction),
		up: Cartesian3.normalize(upWorld, upWorld)
	};
}

function setup({
	allowed = () => true,
	groundHeight = (): number | undefined => 3000
}: {
	allowed?: () => boolean;
	groundHeight?: (point: cesium.Cartographic) => number | undefined;
} = {}) {
	const pose = curatedPose();
	const listeners = new Set<() => void>();
	let destroyed = false;
	const camera = {
		positionWC: Cartesian3.clone(pose.position),
		directionWC: Cartesian3.clone(pose.direction),
		upWC: Cartesian3.clone(pose.up),
		views: 0,
		setView(options: {
			destination: cesium.Cartesian3;
			orientation: { direction: cesium.Cartesian3; up: cesium.Cartesian3 };
		}) {
			camera.views += 1;
			Cartesian3.clone(options.destination, camera.positionWC);
			Cartesian3.clone(options.orientation.direction, camera.directionWC);
			Cartesian3.clone(options.orientation.up, camera.upWC);
		}
	};
	const viewer = {
		camera,
		isDestroyed: () => destroyed,
		scene: {
			ellipsoid: Ellipsoid.WGS84,
			globe: { getHeight: groundHeight },
			preUpdate: {
				addEventListener(listener: () => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			}
		}
	};
	const orbit = new ViewerSummitOrbit(cesium as unknown as CesiumModule, viewer as never, allowed);
	const frame = () => [...listeners].forEach((listener) => listener());

	return {
		orbit,
		camera,
		frame,
		listeners,
		destroy: () => {
			destroyed = true;
		}
	};
}

type Camera = ReturnType<typeof setup>['camera'];

function toSummit(camera: Camera) {
	return Cartesian3.subtract(PIVOT, camera.positionWC, new Cartesian3());
}

function range(camera: Camera): number {
	return Cartesian3.magnitude(toSummit(camera));
}

// Where the summit lies in the camera's own axes: constant while the summit keeps its place on
// screen, its depth and its tilt below the view.
function summitInView(camera: Camera) {
	const offset = toSummit(camera);
	const right = Cartesian3.cross(camera.directionWC, camera.upWC, new Cartesian3());

	return {
		right: Cartesian3.dot(offset, right),
		up: Cartesian3.dot(offset, camera.upWC),
		ahead: Cartesian3.dot(offset, camera.directionWC)
	};
}

// The camera's bearing seen from the summit, in degrees clockwise from north.
function bearing(camera: Camera): number {
	const local = Matrix4.multiplyByPoint(FROM_ENU, camera.positionWC, new Cartesian3());
	const degrees = Math.atan2(local.x, local.y) / DEGREES;

	return (degrees + 360) % 360;
}

function height(camera: Camera): number {
	return Cartographic.fromCartesian(camera.positionWC)!.height;
}

describe('ViewerSummitOrbit', () => {
	let now = 0;
	let visibility: DocumentVisibilityState = 'visible';

	beforeEach(() => {
		now = 1_000;
		visibility = 'visible';
		vi.spyOn(performance, 'now').mockImplementation(() => now);
		vi.stubGlobal('document', {
			get visibilityState() {
				return visibility;
			}
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.restoreAllMocks();
	});

	function turnFor(frame: () => void, seconds: number, frameMs = FRAME_MS) {
		const frames = Math.round((seconds * 1000) / frameMs);
		for (let step = 0; step < frames; step += 1) {
			now += frameMs;
			frame();
		}
	}

	it('starts from the camera as it is, without moving it on the first frame', () => {
		const { orbit, camera, frame } = setup();
		const start = Cartesian3.clone(camera.positionWC);
		const startDirection = Cartesian3.clone(camera.directionWC);

		expect(orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {})).toBe(true);
		frame();

		expect(Cartesian3.equals(camera.positionWC, start)).toBe(true);
		expect(Cartesian3.equals(camera.directionWC, startDirection)).toBe(true);

		now += FRAME_MS;
		frame();
		expect(Cartesian3.distance(camera.positionWC, start)).toBeCloseTo(ONE_FRAME_METERS, 3);
	});

	it('keeps the range, height and the summit in place on screen throughout a revolution', () => {
		const { orbit, camera, frame } = setup();
		const startRange = range(camera);
		const startHeight = height(camera);
		const startView = summitInView(camera);
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {});
		frame();

		for (let second = 0; second < MOUNTAIN_ORBIT_PERIOD_SECONDS; second += 1) {
			turnFor(frame, 1);
			const view = summitInView(camera);
			expect(Math.abs(range(camera) - startRange)).toBeLessThan(1e-6);
			expect(Math.abs(height(camera) - startHeight)).toBeLessThan(0.5);
			expect(Math.abs(view.right - startView.right)).toBeLessThan(1e-6);
			expect(Math.abs(view.up - startView.up)).toBeLessThan(1e-6);
			expect(Math.abs(view.ahead - startView.ahead)).toBeLessThan(1e-6);
		}
	});

	it('turns one steady way through north and back to the pose it started from', () => {
		const { orbit, camera, frame } = setup();
		const start = Cartesian3.clone(camera.positionWC);
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {});
		frame();

		let previous = bearing(camera);
		let travelled = 0;
		let crossedNorth = false;
		const frames = Math.round((MOUNTAIN_ORBIT_PERIOD_SECONDS * 1000) / FRAME_MS);
		for (let step = 0; step < frames; step += 1) {
			now += FRAME_MS;
			frame();
			const current = bearing(camera);
			const delta = current - previous;
			const unwrapped = delta < -180 ? delta + 360 : delta;
			crossedNorth ||= delta < -180;
			expect(unwrapped).toBeGreaterThan(0);
			expect(unwrapped).toBeCloseTo(360 / (MOUNTAIN_ORBIT_PERIOD_SECONDS * 60), 6);
			travelled += unwrapped;
			previous = current;
		}

		expect(crossedNorth).toBe(true);
		expect(travelled).toBeCloseTo(360, 6);
		expect(Cartesian3.distance(camera.positionWC, start)).toBeLessThan(1e-3);
	});

	it('goes on round without drifting over many revolutions', () => {
		const { orbit, camera, frame } = setup();
		const start = Cartesian3.clone(camera.positionWC);
		const startView = summitInView(camera);
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {});
		frame();

		turnFor(frame, MOUNTAIN_ORBIT_PERIOD_SECONDS * 5, 50);

		expect(Cartesian3.distance(camera.positionWC, start)).toBeLessThan(1e-3);
		expect(Math.abs(summitInView(camera).up - startView.up)).toBeLessThan(1e-6);
	});

	it('turns by the time elapsed, whatever the frame rate', () => {
		const smooth = setup();
		smooth.orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {});
		smooth.frame();
		turnFor(smooth.frame, 3, FRAME_MS);

		const choppy = setup();
		choppy.orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {});
		choppy.frame();
		turnFor(choppy.frame, 3, 75);

		expect(Cartesian3.distance(smooth.camera.positionWC, choppy.camera.positionWC)).toBeLessThan(
			0.01
		);
	});

	it('moves no more than one long frame allows after a stall', () => {
		const { orbit, camera, frame } = setup();
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {});
		frame();
		const before = bearing(camera);

		now += 8_000;
		frame();

		expect(bearing(camera) - before).toBeCloseTo((360 * 0.1) / MOUNTAIN_ORBIT_PERIOD_SECONDS, 6);
	});

	it('holds still while the page is hidden and picks up from there when it returns', () => {
		const { orbit, camera, frame } = setup();
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {});
		frame();
		turnFor(frame, 1);
		const before = Cartesian3.clone(camera.positionWC);

		visibility = 'hidden';
		turnFor(frame, 5);
		expect(Cartesian3.equals(camera.positionWC, before)).toBe(true);

		visibility = 'visible';
		now += 30_000;
		frame();
		expect(Cartesian3.equals(camera.positionWC, before)).toBe(true);

		now += FRAME_MS;
		frame();
		expect(Cartesian3.distance(camera.positionWC, before)).toBeCloseTo(ONE_FRAME_METERS, 3);
		expect(orbit.running).toBe(true);
	});

	it('pauses where it is and resumes from there without a jump', () => {
		const halted = vi.fn();
		const { orbit, camera, frame, listeners } = setup();
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		frame();
		turnFor(frame, 7);
		const paused = Cartesian3.clone(camera.positionWC);
		const pausedBearing = bearing(camera);

		orbit.stop();
		turnFor(frame, 2);
		expect(Cartesian3.equals(camera.positionWC, paused)).toBe(true);
		expect(listeners.size).toBe(0);

		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		frame();
		expect(Cartesian3.equals(camera.positionWC, paused)).toBe(true);
		turnFor(frame, 1);

		expect(bearing(camera) - pausedBearing).toBeCloseTo(360 / MOUNTAIN_ORBIT_PERIOD_SECONDS, 6);
		expect(halted).not.toHaveBeenCalled();
	});

	it('lets go at once when someone else moves the camera, and reports it', () => {
		const halted = vi.fn();
		const { orbit, camera, frame, listeners } = setup();
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		frame();
		turnFor(frame, 1);

		const dragged = Cartesian3.add(camera.positionWC, new Cartesian3(30, 0, 0), new Cartesian3());
		camera.setView({
			destination: dragged,
			orientation: { direction: camera.directionWC, up: camera.upWC }
		});
		const views = camera.views;
		now += FRAME_MS;
		frame();

		expect(halted).toHaveBeenCalledOnce();
		expect(orbit.running).toBe(false);
		expect(camera.views).toBe(views);
		expect(Cartesian3.equals(camera.positionWC, dragged)).toBe(true);
		expect(listeners.size).toBe(0);
	});

	it('halts when it is no longer allowed, such as under a flight or reduced motion', () => {
		let allowed = true;
		const halted = vi.fn();
		const { orbit, frame } = setup({ allowed: () => allowed });
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		frame();

		allowed = false;
		now += FRAME_MS;
		frame();

		expect(halted).toHaveBeenCalledOnce();
		expect(orbit.running).toBe(false);
	});

	it('halts before a turn would bring the camera nearer the ground than the floor', () => {
		const halted = vi.fn();
		let ridge = false;
		const { orbit, camera, frame } = setup({
			groundHeight: (point) => (ridge ? point.height - 10 : 3000)
		});
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		frame();
		turnFor(frame, 1);
		const before = Cartesian3.clone(camera.positionWC);

		ridge = true;
		now += FRAME_MS;
		frame();

		expect(halted).toHaveBeenCalledOnce();
		expect(Cartesian3.equals(camera.positionWC, before)).toBe(true);
	});

	it('starts close to the ground where the reader brought it, without halting at once', () => {
		const halted = vi.fn();
		const { orbit, frame } = setup({ groundHeight: (point) => point.height - 20 });
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		frame();
		turnFor(frame, 2);

		expect(halted).not.toHaveBeenCalled();
		expect(orbit.running).toBe(true);
	});

	it('goes on over terrain that has not loaded', () => {
		const halted = vi.fn();
		const { orbit, camera, frame } = setup({ groundHeight: () => undefined });
		const start = Cartesian3.clone(camera.positionWC);
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		frame();
		turnFor(frame, 1);

		expect(halted).not.toHaveBeenCalled();
		expect(Cartesian3.distance(camera.positionWC, start)).toBeGreaterThan(100);
	});

	describe('over rising ground', () => {
		// A ridge on the orbit's path, out where the camera rides, higher than the camera flies.
		const RIDGE_METERS = 11_400;
		const ridge = (from: number, to: number) => (point: cesium.Cartographic) => {
			const local = Matrix4.multiplyByPoint(
				FROM_ENU,
				Cartographic.toCartesian(point),
				new Cartesian3()
			);
			const degrees = (Math.atan2(local.x, local.y) / DEGREES + 360) % 360;
			return degrees >= from && degrees <= to ? RIDGE_METERS : 3_000;
		};

		function elevation(camera: Camera): number {
			const local = Matrix4.multiplyByPoint(FROM_ENU, camera.positionWC, new Cartesian3());
			return Math.asin(local.z / Cartesian3.magnitude(local)) / DEGREES;
		}

		it('climbs over a ridge ahead before reaching it, keeping range and framing, then settles', () => {
			const halted = vi.fn();
			const groundHeight = ridge(275, 300);
			const { orbit, camera, frame } = setup({ groundHeight });
			const startRange = range(camera);
			const startView = summitInView(camera);
			const startElevation = elevation(camera);
			orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
			frame();

			let lowest = Number.POSITIVE_INFINITY;
			let highest = startElevation;
			let previous = startElevation;
			let steepest = 0;
			let settled = Number.NaN;
			const frames = Math.round((MOUNTAIN_ORBIT_PERIOD_SECONDS * 1000) / FRAME_MS);
			for (let step = 0; step < frames; step += 1) {
				now += FRAME_MS;
				frame();
				const ground = Cartographic.fromCartesian(camera.positionWC)!;
				lowest = Math.min(lowest, ground.height - groundHeight(ground));
				const current = elevation(camera);
				highest = Math.max(highest, current);
				steepest = Math.max(steepest, Math.abs(current - previous) / (FRAME_MS / 1000));
				previous = current;
				if (step === Math.round((frames * 2) / 3)) {
					settled = current;
				}
				const view = summitInView(camera);
				expect(Math.abs(range(camera) - startRange)).toBeLessThan(1e-6);
				expect(Math.abs(view.right - startView.right)).toBeLessThan(1e-6);
				expect(Math.abs(view.up - startView.up)).toBeLessThan(1e-6);
			}

			expect(halted).not.toHaveBeenCalled();
			expect(lowest).toBeGreaterThanOrEqual(50);
			expect(highest - startElevation).toBeGreaterThan(3);
			expect(steepest).toBeLessThanOrEqual(2.51);
			// Two thirds round, well past the ridge and before it comes into view again.
			expect(settled - startElevation).toBeLessThan(0.01);
		});

		it('rises with ground that grazes the camera from the start, rather than halting', () => {
			const halted = vi.fn();
			const { orbit, camera, frame } = setup({
				groundHeight: (point) => {
					const local = Matrix4.multiplyByPoint(
						FROM_ENU,
						Cartographic.toCartesian(point),
						new Cartesian3()
					);
					// The pose starts one metre up, on a slope that climbs the way the orbit turns.
					const bearing = (Math.atan2(local.x, local.y) / DEGREES + 360) % 360;
					return height(startCamera) - 1 + (bearing - startBearing) * 20;
				}
			});
			const startCamera = { ...camera, positionWC: Cartesian3.clone(camera.positionWC) };
			const startBearing = bearing(camera);
			orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
			frame();
			turnFor(frame, 3);

			expect(halted).not.toHaveBeenCalled();
			expect(orbit.running).toBe(true);
		});

		// Ground that climbs away from the camera as fast as it turns, `climbDegreesPerSecond` of lift
		// to keep up with, beginning where the orbit reaches it two seconds in.
		function steepRamp(climbDegreesPerSecond: number, camera: Camera) {
			const startBearing = bearing(camera);
			const startHeight = height(camera);
			const metersPerBearingDegree =
				(climbDegreesPerSecond * DEGREES * range(camera)) / (360 / MOUNTAIN_ORBIT_PERIOD_SECONDS);
			return (point: cesium.Cartographic) => {
				const local = Matrix4.multiplyByPoint(
					FROM_ENU,
					Cartographic.toCartesian(point),
					new Cartesian3()
				);
				const ahead = (((Math.atan2(local.x, local.y) / DEGREES - startBearing) % 360) + 360) % 360;
				return ahead < 12 || ahead > 120
					? 3_000
					: startHeight - 400 + (ahead - 12) * metersPerBearingDegree;
			};
		}

		it.each([
			['sixty frames a second', FRAME_MS],
			['thirty frames a second', 1000 / 30]
		])(
			'keeps climbing a steep rise at %s, which a fixed step per frame would halt',
			(_, frameMs) => {
				const halted = vi.fn();
				let ramp: (point: cesium.Cartographic) => number = () => 3_000;
				const { orbit, camera, frame } = setup({ groundHeight: (point) => ramp(point) });
				ramp = steepRamp(5.5, camera);
				orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
				frame();

				let lowest = Number.POSITIVE_INFINITY;
				const frames = Math.round(7000 / frameMs);
				for (let step = 0; step < frames; step += 1) {
					now += frameMs;
					frame();
					const ground = Cartographic.fromCartesian(camera.positionWC)!;
					lowest = Math.min(lowest, ground.height - ramp(ground));
				}

				expect(halted).not.toHaveBeenCalled();
				expect(orbit.running).toBe(true);
				expect(lowest).toBeGreaterThanOrEqual(50 - 1e-6);
			}
		);

		it('still halts on ground that climbs faster than any correction may follow', () => {
			const halted = vi.fn();
			let ramp: (point: cesium.Cartographic) => number = () => 3_000;
			const { orbit, camera, frame } = setup({ groundHeight: (point) => ramp(point) });
			ramp = steepRamp(14, camera);
			orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
			frame();
			turnFor(frame, 7);

			expect(halted).toHaveBeenCalledOnce();
		});

		it('halts rather than jump over ground that appears at once right under the camera', () => {
			const halted = vi.fn();
			let wall = false;
			const { orbit, camera, frame } = setup({
				groundHeight: (point) => (wall ? point.height + 500 : 3000)
			});
			orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
			frame();
			turnFor(frame, 1);
			const before = Cartesian3.clone(camera.positionWC);

			wall = true;
			now += FRAME_MS;
			frame();

			expect(halted).toHaveBeenCalledOnce();
			expect(Cartesian3.equals(camera.positionWC, before)).toBe(true);
		});
	});

	it('keeps one frame listener however often it is started, and none once stopped', () => {
		const halted = vi.fn();
		const { orbit, frame, listeners } = setup();

		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, halted);
		expect(listeners.size).toBe(1);

		orbit.stop();
		orbit.stop();
		frame();

		expect(listeners.size).toBe(0);
		expect(orbit.running).toBe(false);
		expect(halted).not.toHaveBeenCalled();
	});

	it('refuses to start on a destroyed viewer, without a period, or when not allowed', () => {
		const destroyedCase = setup();
		destroyedCase.destroy();
		expect(destroyedCase.orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {})).toBe(false);

		const { orbit, listeners } = setup();
		expect(orbit.start(SUMMIT, 0, () => {})).toBe(false);
		expect(orbit.start(SUMMIT, Number.NaN, () => {})).toBe(false);

		const refused = setup({ allowed: () => false });
		expect(refused.orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {})).toBe(false);

		expect(listeners.size).toBe(0);
		expect(refused.listeners.size).toBe(0);
	});

	it('refuses to circle a camera that stands on the summit itself', () => {
		const { orbit, camera, listeners } = setup();
		Cartesian3.clone(PIVOT, camera.positionWC);

		expect(orbit.start(SUMMIT, MOUNTAIN_ORBIT_PERIOD_SECONDS, () => {})).toBe(false);
		expect(listeners.size).toBe(0);
	});
});
