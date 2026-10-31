import { describe, expect, it } from 'vitest';
import { cesiumVerticalFovRadians, projectSummitNormalized } from './framing';
import { greatCircleDistanceMeters } from './geodesic';
import {
	glideRangeAt,
	lerpAngleDegrees,
	lookPose,
	sampleGlide,
	type GlidePlan,
	type LookState
} from './glidePath';
import { planExploreTransition, planFreshApproach } from './transitionPlan';

const ASPECT = 1.3;
const FOVY = cesiumVerticalFovRadians(Math.PI / 3, ASPECT);

const ACONCAGUA: LookState = {
	latitude: -32.6531,
	longitude: -70.012,
	altitudeMeters: 6961,
	headingDegrees: 66.87,
	pitchDegrees: -19.85,
	rangeMeters: 17_132,
	framingX: -0.0587,
	framingY: 0.3857
};

const EVEREST: LookState = {
	latitude: 27.9881,
	longitude: 86.925,
	altitudeMeters: 8849,
	headingDegrees: 103.3,
	pitchDegrees: 1.39,
	rangeMeters: 14_828,
	framingX: 0.047,
	framingY: 0.4068
};

const AMA_DABLAM: LookState = {
	latitude: 27.8621,
	longitude: 86.8604,
	altitudeMeters: 6814,
	headingDegrees: 350,
	pitchDegrees: -12,
	rangeMeters: 12_000,
	framingX: 0.1,
	framingY: 0.25
};

function glide(plan: ReturnType<typeof planExploreTransition>): GlidePlan {
	if (plan.mode !== 'glide') {
		throw new Error('expected a glide plan');
	}
	return plan;
}

function grid(steps = 200): number[] {
	return Array.from({ length: steps + 1 }, (_, index) => index / steps);
}

const EXPLORES = {
	local: () => glide(planExploreTransition(EVEREST, AMA_DABLAM, 'full')),
	intercontinental: () => glide(planExploreTransition(ACONCAGUA, EVEREST, 'full'))
};

describe('lerpAngleDegrees', () => {
	it('takes the short way around north', () => {
		expect(lerpAngleDegrees(350, 10, 0.5)).toBeCloseTo(360, 8);
		expect(lerpAngleDegrees(10, 350, 0.5)).toBeCloseTo(0, 8);
	});

	it('reaches both ends', () => {
		expect(lerpAngleDegrees(40, 200, 0)).toBe(40);
		expect(lerpAngleDegrees(40, 200, 1)).toBeCloseTo(200, 8);
	});
});

describe('sampleGlide', () => {
	it('starts on the origin view and finishes on the exact destination', () => {
		for (const make of Object.values(EXPLORES)) {
			const plan = make();
			const start = sampleGlide(plan, 0);

			expect(start.latitude).toBeCloseTo(plan.from.latitude, 8);
			expect(start.longitude).toBeCloseTo(plan.from.longitude, 8);
			expect(start.headingDegrees).toBeCloseTo(plan.from.headingDegrees, 8);
			expect(start.pitchDegrees).toBeCloseTo(plan.from.pitchDegrees, 8);
			expect(start.rangeMeters).toBeCloseTo(plan.from.rangeMeters, 6);
			expect(start.framingX).toBeCloseTo(plan.from.framingX, 8);
			expect(start.framingY).toBeCloseTo(plan.from.framingY, 8);
			expect(sampleGlide(plan, 1)).toEqual({ ...plan.to, routeFraction: 1 });
		}
	});

	it('never produces a non-finite or non-positive value', () => {
		const plans = [
			...Object.values(EXPLORES).map((make) => make()),
			glide(planFreshApproach(ACONCAGUA, 'full')),
			glide(planFreshApproach(EVEREST, 'full'))
		];
		for (const plan of plans) {
			for (const fraction of grid()) {
				const frame = sampleGlide(plan, fraction);

				for (const value of Object.values(frame)) {
					expect(Number.isFinite(value)).toBe(true);
				}
				expect(frame.rangeMeters).toBeGreaterThan(0);
				expect(frame.latitude).toBeGreaterThanOrEqual(-90);
				expect(frame.latitude).toBeLessThanOrEqual(90);
				expect(frame.longitude).toBeGreaterThanOrEqual(-180);
				expect(frame.longitude).toBeLessThanOrEqual(180);
			}
		}
	});

	it('climbs to the peak at the end of the ascent and then only descends', () => {
		const plan = EXPLORES.intercontinental();
		const ranges = grid().map((fraction) => glideRangeAt(plan, fraction));
		const peakIndex = Math.round(plan.ascentFraction * 200);

		expect(glideRangeAt(plan, plan.ascentFraction)).toBeCloseTo(plan.peak.rangeMeters, 3);
		for (let index = 1; index <= peakIndex; index += 1) {
			expect(ranges[index]).toBeGreaterThanOrEqual(ranges[index - 1]!);
		}
		for (let index = peakIndex + 1; index < ranges.length; index += 1) {
			expect(ranges[index]).toBeLessThanOrEqual(ranges[index - 1]!);
		}
		expect(Math.max(...ranges)).toBeCloseTo(plan.peak.rangeMeters, 3);
	});

	it('travels along the great circle through its midpoint at the peak of a shorter route', () => {
		const plan = glide(planExploreTransition(AMA_DABLAM, ACONCAGUA, 'full'));
		const peak = sampleGlide({ ...plan, sweepWeight: 0 }, plan.ascentFraction);
		const total = plan.distanceMeters;

		expect(peak.routeFraction).toBeCloseTo(0.5, 8);
		expect(greatCircleDistanceMeters(plan.from, peak)).toBeCloseTo(total / 2, -2);
		expect(greatCircleDistanceMeters(peak, plan.to)).toBeCloseTo(total / 2, -2);
		expect(peak.pitchDegrees).toBeCloseTo(plan.peak.pitchDegrees, 8);
		expect(peak.framingX).toBeCloseTo(0, 8);
		expect(peak.framingY).toBeCloseTo(0, 8);
	});

	it('reaches the peak pose with the route about halfway for a long-haul route', () => {
		const plan = EXPLORES.intercontinental();
		const peak = sampleGlide(plan, plan.ascentFraction);

		expect(plan.sweepWeight).toBe(1);
		expect(peak.routeFraction).toBeGreaterThan(0.3);
		expect(peak.routeFraction).toBeLessThan(0.7);
		expect(peak.pitchDegrees).toBeCloseTo(plan.peak.pitchDegrees, 8);
		expect(peak.framingX).toBeCloseTo(0, 8);
		expect(peak.framingY).toBeCloseTo(0, 8);
	});

	describe('long-haul pacing', () => {
		function routeWindowSeconds(plan: GlidePlan, from: number, to: number): number {
			const fractions = grid(1000).map((fraction) => sampleGlide(plan, fraction).routeFraction);
			const first = fractions.findIndex((value) => value >= from);
			const last = fractions.findIndex((value) => value >= to);
			return ((last - first) / 1000) * plan.durationSeconds;
		}

		function peakSpeed(plan: GlidePlan): number {
			const fractions = grid(1000).map((fraction) => sampleGlide(plan, fraction).routeFraction);
			let fastest = 0;
			for (let index = 1; index < fractions.length; index += 1) {
				fastest = Math.max(fastest, fractions[index]! - fractions[index - 1]!);
			}
			return (fastest * plan.distanceMeters) / (plan.durationSeconds / 1000);
		}

		const unshaped = (plan: GlidePlan): GlidePlan => ({
			...plan,
			ascentFraction: 0.45,
			lingerExponent: 1,
			sweepWeight: 0
		});

		it('spends more time crossing the middle of the route than the unshaped timing', () => {
			const plan = EXPLORES.intercontinental();

			expect(routeWindowSeconds(plan, 0.1, 0.9)).toBeGreaterThan(
				routeWindowSeconds(unshaped(plan), 0.1, 0.9) * 1.3
			);
		});

		it('lowers the fastest ground speed around the apex', () => {
			const plan = EXPLORES.intercontinental();

			expect(peakSpeed(plan)).toBeLessThan(peakSpeed(unshaped(plan)) * 0.7);
		});

		it('keeps advancing through the apex instead of stalling there', () => {
			const plan = EXPLORES.intercontinental();
			const before = sampleGlide(plan, plan.ascentFraction - 0.03).routeFraction;
			const after = sampleGlide(plan, plan.ascentFraction + 0.03).routeFraction;

			expect(after - before).toBeGreaterThan(0.1);
		});

		it('crosses the route while the camera is still at global scale', () => {
			const plan = EXPLORES.intercontinental();
			const rangeAt = (routeFraction: number) => {
				const frame = grid(1000)
					.map((fraction) => sampleGlide(plan, fraction))
					.find((candidate) => candidate.routeFraction >= routeFraction);
				return frame?.rangeMeters ?? 0;
			};

			expect(rangeAt(0.1)).toBeGreaterThan(plan.peak.rangeMeters * 0.5);
			expect(rangeAt(0.9)).toBeGreaterThan(plan.peak.rangeMeters * 0.3);
		});

		it('holds the range near the peak longer than the unshaped timing without a plateau', () => {
			const plan = EXPLORES.intercontinental();
			const near = (candidate: GlidePlan) =>
				grid(1000).filter(
					(fraction) => glideRangeAt(candidate, fraction) > candidate.peak.rangeMeters * 0.8
				).length;

			expect(near(plan)).toBeGreaterThan(near(unshaped(plan)));
			expect(glideRangeAt(plan, plan.ascentFraction + 0.03)).toBeLessThan(plan.peak.rangeMeters);
		});

		it('keeps the route monotonic and bounded for a near-antipodal route', () => {
			const plan = glide(
				planExploreTransition(
					{ ...ACONCAGUA, latitude: 0, longitude: 0 },
					{ ...EVEREST, latitude: 0, longitude: 179.9 },
					'full'
				)
			);
			let previous = 0;
			for (const fraction of grid(500)) {
				const frame = sampleGlide(plan, fraction);

				expect(frame.routeFraction).toBeGreaterThanOrEqual(previous - 1e-12);
				expect(frame.routeFraction).toBeLessThanOrEqual(1);
				expect(Number.isFinite(frame.latitude)).toBe(true);
				previous = frame.routeFraction;
			}
		});
	});

	it('only moves forward along the route', () => {
		for (const make of Object.values(EXPLORES)) {
			const fractions = grid().map((fraction) => sampleGlide(make(), fraction).routeFraction);

			for (let index = 1; index < fractions.length; index += 1) {
				expect(fractions[index]).toBeGreaterThanOrEqual(fractions[index - 1]! - 1e-12);
			}
		}
	});

	it('stays over the origin while the camera first pulls back', () => {
		const plan = EXPLORES.intercontinental();
		const early = sampleGlide(plan, plan.ascentFraction * 0.4);

		expect(greatCircleDistanceMeters(plan.from, early)).toBeLessThan(plan.distanceMeters * 0.05);
	});

	it('turns the heading the short way between the origin and the route', () => {
		const plan = glide(planExploreTransition(AMA_DABLAM, EVEREST, 'full'));
		const headings = grid().map((fraction) => sampleGlide(plan, fraction).headingDegrees);

		for (let index = 1; index < headings.length; index += 1) {
			const step = ((((headings[index]! - headings[index - 1]! + 180) % 360) + 360) % 360) - 180;
			expect(Math.abs(step)).toBeLessThan(20);
		}
	});

	it('starts the reveal on a north-up globe and tilts toward the final pose', () => {
		const plan = glide(planFreshApproach(ACONCAGUA, 'full'));
		const start = sampleGlide(plan, 0);
		const middle = sampleGlide(plan, 0.5);

		expect(start.pitchDegrees).toBeCloseTo(plan.from.pitchDegrees, 8);
		expect(start.headingDegrees).toBeCloseTo(0, 8);
		expect(start.latitude).toBeCloseTo(ACONCAGUA.latitude, 8);
		expect(middle.rangeMeters).toBeLessThan(plan.from.rangeMeters);
		expect(middle.pitchDegrees).toBeGreaterThan(plan.from.pitchDegrees);
		expect(middle.pitchDegrees).toBeLessThan(ACONCAGUA.pitchDegrees);
		expect(middle.latitude).toBeCloseTo(ACONCAGUA.latitude, 8);
	});

	it('lets the globe linger before the descent without holding the camera still', () => {
		const plan = glide(planFreshApproach(ACONCAGUA, 'full'));
		const unshaped = { ...plan, lingerExponent: 1 };

		expect(glideRangeAt(plan, 0.3)).toBeGreaterThan(8_000_000);
		expect(glideRangeAt(unshaped, 0.3)).toBeLessThan(8_000_000);
		expect(glideRangeAt(plan, 0.1)).toBeLessThan(plan.from.rangeMeters);
	});

	it('shrinks the range through the reveal without ever growing it back', () => {
		const plan = glide(planFreshApproach(EVEREST, 'full'));
		const ranges = grid().map((fraction) => glideRangeAt(plan, fraction));

		for (let index = 1; index < ranges.length; index += 1) {
			expect(ranges[index]).toBeLessThanOrEqual(ranges[index - 1]!);
		}
		expect(ranges.at(-1)).toBeCloseTo(EVEREST.rangeMeters, 6);
	});
});

describe('lookPose', () => {
	function projectedFraming(look: LookState) {
		const pose = lookPose(look, FOVY, ASPECT);
		if (!pose) {
			throw new Error('expected a pose');
		}
		return projectSummitNormalized(pose.cameraFromFocus, pose.axes, FOVY, ASPECT);
	}

	it('keeps the curated framing at arrival for a visibly off-centre fixture', () => {
		for (const destination of [ACONCAGUA, EVEREST]) {
			const plan = glide(planExploreTransition(AMA_DABLAM, destination, 'full'));
			const arrival = projectedFraming(sampleGlide(plan, 1));

			expect(arrival?.x).toBeCloseTo(destination.framingX, 6);
			expect(arrival?.y).toBeCloseTo(destination.framingY, 6);
		}
	});

	it('produces the same pose at arrival as direct placement', () => {
		const plan = glide(planFreshApproach(ACONCAGUA, 'full'));
		const arrival = lookPose(sampleGlide(plan, 1), FOVY, ASPECT);
		const direct = lookPose(ACONCAGUA, FOVY, ASPECT);

		expect(arrival).toEqual(direct);
	});

	it('arrives at a positive pitch with the camera below the summit', () => {
		const plan = glide(planExploreTransition(ACONCAGUA, EVEREST, 'full'));
		const pose = lookPose(sampleGlide(plan, 1), FOVY, ASPECT);

		expect(plan.to.pitchDegrees).toBeGreaterThan(0);
		expect(pose?.cameraFromFocus.z).toBeLessThan(0);
		expect(pose?.axes.direction.z).toBeGreaterThan(-1);
	});

	it('keeps the destination inside the field of view through the whole descent', () => {
		const plans = [
			glide(planFreshApproach(ACONCAGUA, 'full')),
			glide(planFreshApproach(EVEREST, 'full')),
			EXPLORES.intercontinental(),
			EXPLORES.local(),
			glide(planExploreTransition(AMA_DABLAM, ACONCAGUA, 'full'))
		];
		const halfDiagonal = Math.atan(Math.hypot(Math.tan(FOVY / 2), Math.tan(FOVY / 2) * ASPECT));
		for (const plan of plans) {
			for (const fraction of grid().filter((value) => value >= plan.phases[1].startFraction)) {
				const frame = sampleGlide(plan, fraction);
				const pose = lookPose(frame, FOVY, ASPECT);
				expect(pose).toBeDefined();
				if (!pose) {
					continue;
				}
				const camera = sphericalPoint(frame, pose.cameraFromFocus);
				const focusBasis = enuBasis(frame);
				const toDestination = subtract(sphericalPoint(plan.to), camera);
				const direction = combine(focusBasis, pose.axes.direction);
				const angle = Math.acos(dot(normalize(toDestination), normalize(direction)));
				expect(angle).toBeLessThan(halfDiagonal);
			}
		}
	});

	it('solves a pose for every frame, including near-nadir globe views', () => {
		const plans = [
			glide(planFreshApproach(ACONCAGUA, 'full')),
			glide(planFreshApproach(EVEREST, 'full')),
			EXPLORES.intercontinental(),
			EXPLORES.local()
		];
		for (const plan of plans) {
			for (const fraction of grid()) {
				const pose = lookPose(sampleGlide(plan, fraction), FOVY, ASPECT);
				expect(pose).toBeDefined();
				const direction = pose?.axes.direction;
				expect(Math.hypot(direction?.x ?? 0, direction?.y ?? 0, direction?.z ?? 0)).toBeCloseTo(
					1,
					8
				);
			}
		}
	});
});

type Vector = [number, number, number];

const EARTH_RADIUS = 6_371_008.8;

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function enuBasis(point: { latitude: number; longitude: number }) {
	const φ = toRadians(point.latitude);
	const λ = toRadians(point.longitude);
	const east: Vector = [-Math.sin(λ), Math.cos(λ), 0];
	const north: Vector = [-Math.sin(φ) * Math.cos(λ), -Math.sin(φ) * Math.sin(λ), Math.cos(φ)];
	const up: Vector = [Math.cos(φ) * Math.cos(λ), Math.cos(φ) * Math.sin(λ), Math.sin(φ)];
	return { east, north, up };
}

function combine(
	basis: ReturnType<typeof enuBasis>,
	local: { x: number; y: number; z: number }
): Vector {
	return [0, 1, 2].map(
		(index) =>
			basis.east[index]! * local.x + basis.north[index]! * local.y + basis.up[index]! * local.z
	) as Vector;
}

function sphericalPoint(
	focus: { latitude: number; longitude: number; altitudeMeters: number },
	offset: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
): Vector {
	const basis = enuBasis(focus);
	const ground = basis.up.map((component) => component * (EARTH_RADIUS + focus.altitudeMeters));
	const shift = combine(basis, offset);
	return [ground[0]! + shift[0], ground[1]! + shift[1], ground[2]! + shift[2]];
}

function subtract(a: Vector, b: Vector): Vector {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function dot(a: Vector, b: Vector): number {
	return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(vector: Vector): Vector {
	const length = Math.hypot(...vector);
	return [vector[0] / length, vector[1] / length, vector[2] / length];
}
