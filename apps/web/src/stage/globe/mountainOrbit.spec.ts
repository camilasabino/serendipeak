import { describe, expect, it } from 'vitest';
import {
	MAX_ORBIT_ELEVATION,
	MAX_ORBIT_FRAME_SECONDS,
	MOUNTAIN_ORBIT_PERIOD_SECONDS,
	NO_LIFT,
	advanceOrbitAngle,
	easeLift,
	liftForClimb,
	maxLiftCorrection,
	orbitClearanceFloorMeters,
	type OrbitLift
} from './mountainOrbit';
import { MIN_TERRAIN_CLEARANCE_METERS } from './zoomStep';

const FULL_TURN = 2 * Math.PI;

describe('advanceOrbitAngle', () => {
	it('turns in proportion to the time elapsed, not the number of frames', () => {
		let fast = 0;
		for (let frame = 0; frame < 60; frame += 1) {
			fast = advanceOrbitAngle(fast, 1 / 60, MOUNTAIN_ORBIT_PERIOD_SECONDS);
		}
		let slow = 0;
		for (let frame = 0; frame < 20; frame += 1) {
			slow = advanceOrbitAngle(slow, 1 / 20, MOUNTAIN_ORBIT_PERIOD_SECONDS);
		}

		expect(fast).toBeCloseTo(FULL_TURN / MOUNTAIN_ORBIT_PERIOD_SECONDS, 12);
		expect(slow).toBeCloseTo(fast, 12);
	});

	it('turns no further than one long frame allows after a stall', () => {
		const step = advanceOrbitAngle(0, 30, MOUNTAIN_ORBIT_PERIOD_SECONDS);

		expect(step).toBeCloseTo((FULL_TURN * MAX_ORBIT_FRAME_SECONDS) / MOUNTAIN_ORBIT_PERIOD_SECONDS);
	});

	it('never turns backwards when the clock does', () => {
		expect(advanceOrbitAngle(1, -0.5, MOUNTAIN_ORBIT_PERIOD_SECONDS)).toBe(1);
	});

	it('wraps past a full revolution into the next one, continuously', () => {
		const before = FULL_TURN - 0.001;
		const after = advanceOrbitAngle(before, 0.05, MOUNTAIN_ORBIT_PERIOD_SECONDS);
		const step = (FULL_TURN * 0.05) / MOUNTAIN_ORBIT_PERIOD_SECONDS;

		expect(after).toBeGreaterThanOrEqual(0);
		expect(after).toBeLessThan(FULL_TURN);
		expect(after).toBeCloseTo(before + step - FULL_TURN, 12);
	});
});

describe('orbitClearanceFloorMeters', () => {
	it('keeps the usual floor for a camera well above the ground or over unloaded terrain', () => {
		expect(orbitClearanceFloorMeters(4000)).toBe(MIN_TERRAIN_CLEARANCE_METERS);
		expect(orbitClearanceFloorMeters(undefined)).toBe(MIN_TERRAIN_CLEARANCE_METERS);
	});

	it('lets a camera brought lower than the floor keep its own height as the floor', () => {
		expect(orbitClearanceFloorMeters(20)).toBe(20);
	});
});

describe('liftForClimb', () => {
	const DEGREE = Math.PI / 180;
	const RANGE = 12_000;

	it('raises the camera around the summit by the height asked, keeping its range', () => {
		const start = -18 * DEGREE;
		const lift = liftForClimb(start, 0, RANGE, 500);

		const climbed = RANGE * Math.sin(start + lift) - RANGE * Math.sin(start);
		expect(climbed).toBeCloseTo(500, 6);
	});

	it('climbs from the lift already in force', () => {
		const start = 9 * DEGREE;
		const first = liftForClimb(start, 0, RANGE, 300);

		expect(liftForClimb(start, first, RANGE, 0)).toBeCloseTo(first, 12);
		expect(liftForClimb(start, first, RANGE, 300)).toBeGreaterThan(first);
	});

	it('never lowers the camera below where the reader left it', () => {
		expect(liftForClimb(-10 * DEGREE, 0, RANGE, -800)).toBe(0);
	});

	it('never climbs past the steepest elevation allowed', () => {
		const start = 60 * DEGREE;

		expect(liftForClimb(start, 0, RANGE, 50_000)).toBeCloseTo(MAX_ORBIT_ELEVATION - start, 12);
	});
});

describe('easeLift', () => {
	const DEGREE = Math.PI / 180;
	const FRAME = 1 / 60;

	function run(from: OrbitLift, target: number, seconds: number): OrbitLift[] {
		const frames: OrbitLift[] = [];
		let lift = from;
		for (let frame = 0; frame < Math.round(seconds / FRAME); frame += 1) {
			lift = easeLift(lift, target, FRAME);
			frames.push(lift);
		}
		return frames;
	}

	it('starts a climb gently rather than at full speed', () => {
		const [first] = run(NO_LIFT, 5 * DEGREE, FRAME);

		expect(first!.rate).toBeCloseTo(2.5 * DEGREE * FRAME, 12);
	});

	it('reaches a climb without ever outpacing its limits or turning back', () => {
		const frames = run(NO_LIFT, 3 * DEGREE, 6);
		const rates = frames.map((lift) => lift.rate);

		expect(frames.at(-1)!.radians).toBeCloseTo(3 * DEGREE, 3);
		expect(Math.max(...rates)).toBeLessThanOrEqual(2.5 * DEGREE + 1e-12);
		expect(Math.min(...rates)).toBeGreaterThanOrEqual(-1e-6);
		for (let i = 1; i < rates.length; i += 1) {
			expect(Math.abs(rates[i]! - rates[i - 1]!)).toBeLessThanOrEqual(2.5 * DEGREE * FRAME + 1e-12);
		}
	});

	it('settles back more slowly than it climbs, and never below the reader pose', () => {
		const settling = run({ radians: 3 * DEGREE, rate: 0 }, 0, 20);
		const fastest = Math.min(...settling.map((lift) => lift.rate));

		expect(fastest).toBeGreaterThanOrEqual(-0.75 * DEGREE - 1e-12);
		expect(settling.every((lift) => lift.radians >= 0)).toBe(true);
		expect(settling.at(-1)!.radians).toBeLessThan(0.01 * DEGREE);
	});

	it('moves no further than one long frame allows after a stall', () => {
		const stalled = easeLift({ radians: 0, rate: 2.5 * DEGREE }, 10 * DEGREE, 30);

		expect(stalled.radians).toBeLessThanOrEqual(2.75 * DEGREE * MAX_ORBIT_FRAME_SECONDS);
	});
});

describe('maxLiftCorrection', () => {
	const DEGREE = Math.PI / 180;

	it('allows a tenth of a degree to a frame at sixty frames a second', () => {
		expect(maxLiftCorrection(1 / 60)).toBeCloseTo(0.1 * DEGREE, 12);
	});

	it('allows more to a longer frame, in proportion to its time', () => {
		expect(maxLiftCorrection(1 / 30)).toBeCloseTo(2 * maxLiftCorrection(1 / 60), 12);
	});

	it('allows no more than one long frame does after a stall, and nothing for a backwards clock', () => {
		expect(maxLiftCorrection(30)).toBeCloseTo(6 * DEGREE * MAX_ORBIT_FRAME_SECONDS, 12);
		expect(maxLiftCorrection(-1)).toBe(0);
	});
});
