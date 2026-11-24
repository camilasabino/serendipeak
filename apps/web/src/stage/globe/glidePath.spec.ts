import { describe, expect, it } from 'vitest';
import { cesiumVerticalFovRadians, projectSummitNormalized } from './framing';
import { greatCircleDistanceMeters } from './geodesic';
import {
	glidePeakFraction,
	glideRangeAt,
	lerpAngleDegrees,
	lookPose,
	sampleGlide,
	timeGlide,
	type GlidePlan,
	type LookState
} from './glidePath';
import {
	glideBaseSeconds,
	planExploreTransition,
	planFreshApproach,
	TRANSITION_POLICY
} from './transitionPlan';

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

const FITZ_ROY: LookState = {
	latitude: -49.2712,
	longitude: -73.0432,
	altitudeMeters: 3405,
	headingDegrees: 281.84,
	pitchDegrees: -7.46,
	rangeMeters: 13_743,
	framingX: 0.036,
	framingY: 0.4488
};

const CERRO_TORRE: LookState = {
	latitude: -49.2906,
	longitude: -73.099,
	altitudeMeters: 3133,
	headingDegrees: 299.02,
	pitchDegrees: 9.52,
	rangeMeters: 13_238,
	framingX: 0.0003,
	framingY: 0.4211
};

const ATLAS_OVERVIEW: LookState = {
	latitude: 20,
	longitude: -60,
	altitudeMeters: 0,
	headingDegrees: 0,
	pitchDegrees: -89,
	rangeMeters: 18_000_000,
	framingX: 0,
	framingY: 0
};

const ANTIPODE_OF_ACONCAGUA: LookState = {
	...EVEREST,
	latitude: 32.0,
	longitude: 109.5
};

const JOURNEYS = {
	nearby: () => glide(planExploreTransition(FITZ_ROY, CERRO_TORRE, 'full')),
	regional: () => glide(planExploreTransition(ACONCAGUA, FITZ_ROY, 'full')),
	intercontinental: () => glide(planExploreTransition(ACONCAGUA, EVEREST, 'full')),
	antipodal: () => glide(planExploreTransition(ACONCAGUA, ANTIPODE_OF_ACONCAGUA, 'full')),
	fromAtlas: () => glide(planExploreTransition(ATLAS_OVERVIEW, ACONCAGUA, 'full')),
	reveal: () => glide(planFreshApproach(EVEREST, 'full'))
};

function headingStep(from: number, to: number): number {
	return ((((to - from + 180) % 360) + 360) % 360) - 180;
}

interface Rates {
	zoom: number;
	slide: number;
	turnDegrees: number;
	tiltDegrees: number;
}

const FRAME_SECONDS = 1 / 60;

// Rates per second between consecutive 60 fps frames: zoom in factors of e, slide in camera ranges.
function frameRates(plan: GlidePlan): Rates[] {
	const frames = Math.round(plan.durationSeconds / FRAME_SECONDS);
	const samples = Array.from({ length: frames + 1 }, (_, index) =>
		sampleGlide(plan, index / frames)
	);
	const seconds = plan.durationSeconds / frames;
	return samples.slice(1).map((frame, index) => {
		const previous = samples[index]!;
		return {
			zoom: Math.abs(Math.log(frame.rangeMeters / previous.rangeMeters)) / seconds,
			slide:
				greatCircleDistanceMeters(previous, frame) /
				Math.sqrt(previous.rangeMeters * frame.rangeMeters) /
				seconds,
			turnDegrees: Math.abs(headingStep(previous.headingDegrees, frame.headingDegrees)) / seconds,
			tiltDegrees: Math.abs(frame.pitchDegrees - previous.pitchDegrees) / seconds
		};
	});
}

function perceivedSpeed({ zoom, slide, turnDegrees, tiltDegrees }: Rates): number {
	return Math.hypot(zoom, slide, toRadians(turnDegrees), toRadians(tiltDegrees));
}

describe('sampleGlide', () => {
	it('starts on the origin view and finishes on the exact destination', () => {
		for (const make of Object.values(JOURNEYS)) {
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
			...Object.values(JOURNEYS).map((make) => make()),
			glide(planFreshApproach(ACONCAGUA, 'full'))
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

	it('climbs to the peak and then only descends', () => {
		const plan = JOURNEYS.intercontinental();
		const peakFraction = glidePeakFraction(plan);
		const ranges = grid().map((fraction) => glideRangeAt(plan, fraction));
		const peakIndex = Math.floor(peakFraction * 200);

		expect(glideRangeAt(plan, peakFraction)).toBeCloseTo(plan.peak!.rangeMeters, 0);
		for (let index = 1; index <= peakIndex; index += 1) {
			expect(ranges[index]).toBeGreaterThanOrEqual(ranges[index - 1]!);
		}
		for (let index = peakIndex + 2; index < ranges.length; index += 1) {
			expect(ranges[index]).toBeLessThanOrEqual(ranges[index - 1]!);
		}
	});

	it('reaches the peak pose with the route about halfway', () => {
		for (const plan of [JOURNEYS.regional(), JOURNEYS.intercontinental()]) {
			const peak = sampleGlide(plan, glidePeakFraction(plan));

			expect(peak.routeFraction).toBeGreaterThan(0.3);
			expect(peak.routeFraction).toBeLessThan(0.7);
			expect(peak.pitchDegrees).toBeCloseTo(plan.peak!.pitchDegrees, 6);
			expect(peak.framingX).toBeCloseTo(0, 6);
			expect(peak.framingY).toBeCloseTo(0, 6);
		}
	});

	it('crosses the route while the camera is high', () => {
		for (const plan of [JOURNEYS.regional(), JOURNEYS.intercontinental()]) {
			const frames = grid(1000).map((fraction) => sampleGlide(plan, fraction));
			const rangeAt = (routeFraction: number) =>
				frames.find((frame) => frame.routeFraction >= routeFraction)!.rangeMeters;

			expect(rangeAt(0.1)).toBeGreaterThan(plan.peak!.rangeMeters * 0.3);
			expect(rangeAt(0.9)).toBeGreaterThan(plan.peak!.rangeMeters * 0.3);
		}
	});

	it('only moves forward along the route, monotonically and within bounds', () => {
		const antipodal = glide(
			planExploreTransition(
				{ ...ACONCAGUA, latitude: 0, longitude: 0 },
				{ ...EVEREST, latitude: 0, longitude: 179.9 },
				'full'
			)
		);
		for (const plan of [...Object.values(JOURNEYS).map((make) => make()), antipodal]) {
			let previous = 0;
			for (const fraction of grid(500)) {
				const frame = sampleGlide(plan, fraction);

				expect(frame.routeFraction).toBeGreaterThanOrEqual(previous - 1e-12);
				expect(frame.routeFraction).toBeLessThanOrEqual(1);
				previous = frame.routeFraction;
			}
		}
	});

	it('stays over the origin while the camera first pulls back', () => {
		const plan = JOURNEYS.intercontinental();
		const early = sampleGlide(plan, glidePeakFraction(plan) * 0.4);

		expect(greatCircleDistanceMeters(plan.from, early)).toBeLessThan(plan.distanceMeters * 0.05);
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
		const at = (seconds: number) => glideRangeAt(plan, seconds / plan.durationSeconds);

		expect(at(0.7)).toBeGreaterThan(plan.from.rangeMeters * 0.5);
		expect(at(0.4)).toBeLessThan(plan.from.rangeMeters);
	});

	it('shrinks the range through the reveal without ever growing it back', () => {
		const plan = JOURNEYS.reveal();
		const ranges = grid().map((fraction) => glideRangeAt(plan, fraction));

		for (let index = 1; index < ranges.length; index += 1) {
			expect(ranges[index]).toBeLessThanOrEqual(ranges[index - 1]!);
		}
		expect(ranges.at(-1)).toBeCloseTo(EVEREST.rangeMeters, 6);
	});
});

describe('glide pacing', () => {
	it('keeps moving through the apex instead of stalling between the climb and the descent', () => {
		for (const make of Object.values(JOURNEYS)) {
			const speeds = frameRates(make()).map(perceivedSpeed);
			const fastest = Math.max(...speeds);
			const middle = speeds.slice(Math.floor(speeds.length * 0.2), Math.ceil(speeds.length * 0.8));

			expect(Math.min(...middle)).toBeGreaterThan(fastest * 0.2);
		}
	});

	it('starts from rest and settles to rest', () => {
		for (const make of Object.values(JOURNEYS)) {
			const speeds = frameRates(make()).map(perceivedSpeed);
			const fastest = Math.max(...speeds);

			expect(speeds[0]).toBeLessThan(fastest * 0.05);
			expect(speeds.at(-1)).toBeLessThan(fastest * 0.05);
		}
	});

	it('never zooms, turns or tilts faster than a deliberate pace', () => {
		for (const make of Object.values(JOURNEYS)) {
			for (const rates of frameRates(make())) {
				expect(rates.zoom).toBeLessThan(4.5);
				expect(rates.turnDegrees).toBeLessThan(80);
				expect(rates.tiltDegrees).toBeLessThan(65);
			}
		}
	});

	it('sweeps the ground across the view at a legible pace on every route', () => {
		for (const make of Object.values(JOURNEYS)) {
			for (const rates of frameRates(make())) {
				expect(rates.slide).toBeLessThan(1.3);
			}
		}
	});

	it('turns the globe beneath a long route at a legible angular pace', () => {
		for (const make of [JOURNEYS.intercontinental, JOURNEYS.antipodal]) {
			const plan = make();
			const frames = Math.round(plan.durationSeconds / FRAME_SECONDS);
			const seconds = plan.durationSeconds / frames;
			let previous = sampleGlide(plan, 0);
			for (let index = 1; index <= frames; index += 1) {
				const frame = sampleGlide(plan, index / frames);
				const turnDegrees = toDegrees(greatCircleDistanceMeters(previous, frame) / EARTH_RADIUS);

				expect(turnDegrees / seconds).toBeLessThan(90);
				previous = frame;
			}
		}
	});

	it('reverses the climb into the descent without a jolt', () => {
		for (const make of [JOURNEYS.nearby, JOURNEYS.regional, JOURNEYS.intercontinental]) {
			const plan = make();
			const frames = Math.round(plan.durationSeconds / FRAME_SECONDS);
			const seconds = plan.durationSeconds / frames;
			const samples = grid(frames).map((fraction) => sampleGlide(plan, fraction));
			const tilt = samples
				.slice(1)
				.map((frame, index) => (frame.pitchDegrees - samples[index]!.pitchDegrees) / seconds);
			const zoom = samples
				.slice(1)
				.map((frame, index) => Math.log(frame.rangeMeters / samples[index]!.rangeMeters) / seconds);

			for (let index = 1; index < tilt.length; index += 1) {
				expect(Math.abs(tilt[index]! - tilt[index - 1]!) / seconds).toBeLessThan(750);
				expect(Math.abs(zoom[index]! - zoom[index - 1]!) / seconds).toBeLessThan(15);
			}
		}
	});

	it('gives the final approach a slow, legible share of the glide', () => {
		for (const make of [JOURNEYS.regional, JOURNEYS.intercontinental, JOURNEYS.fromAtlas]) {
			const plan = make();

			expect((1 - plan.phases[1].startFraction) * plan.durationSeconds).toBeGreaterThan(2.6);
		}
	});

	it('leaves no perceptible snap between the last animated frame and the destination', () => {
		for (const make of Object.values(JOURNEYS)) {
			const plan = make();
			const last = sampleGlide(plan, 1 - FRAME_SECONDS / plan.durationSeconds);

			expect(Math.abs(last.rangeMeters / plan.to.rangeMeters - 1)).toBeLessThan(1e-3);
			expect(Math.abs(headingStep(last.headingDegrees, plan.to.headingDegrees))).toBeLessThan(0.05);
			expect(Math.abs(last.pitchDegrees - plan.to.pitchDegrees)).toBeLessThan(0.05);
			expect(greatCircleDistanceMeters(last, plan.to)).toBeLessThan(1);
		}
	});
});

describe('glide arrival', () => {
	const DESCENTS = [
		JOURNEYS.regional,
		JOURNEYS.intercontinental,
		JOURNEYS.fromAtlas,
		JOURNEYS.reveal
	];

	interface DescentFrame extends Rates {
		rangeMeters: number;
	}

	// Rates of the frames after the apex, each with the range it reaches.
	function descentRates(plan: GlidePlan): DescentFrame[] {
		const rates = frameRates(plan);
		const apex = glidePeakFraction(plan);
		return rates
			.map((frame, index) => ({ ...frame, fraction: (index + 1) / rates.length }))
			.filter(({ fraction }) => fraction > apex)
			.map(({ fraction, ...frame }) => ({ ...frame, rangeMeters: glideRangeAt(plan, fraction) }));
	}

	function withoutArrival(plan: GlidePlan) {
		return timeGlide(plan, {
			baseSeconds: glideBaseSeconds,
			arrival: {
				rangeMeters: TRANSITION_POLICY.approachRangeMeters,
				...TRANSITION_POLICY.arrival,
				secondsPerLength: 0
			},
			sweep: TRANSITION_POLICY.sweep
		});
	}

	it('leaves the climb timed exactly as the base pace times it', () => {
		for (const make of [JOURNEYS.nearby, JOURNEYS.regional, JOURNEYS.intercontinental]) {
			const plan = make();
			const base = withoutArrival(plan);
			const apexSeconds = glidePeakFraction(base) * base.durationSeconds;

			expect(glidePeakFraction(plan) * plan.durationSeconds).toBeCloseTo(apexSeconds, 2);
			for (let seconds = 0; seconds <= apexSeconds; seconds += 0.1) {
				const range = glideRangeAt(plan, seconds / plan.durationSeconds);
				const baseRange = glideRangeAt(base, seconds / base.durationSeconds);

				expect(range / baseRange).toBeCloseTo(1, 2);
			}
			expect(plan.durationSeconds).toBeGreaterThan(base.durationSeconds);
		}
	});

	// A descent that already starts calm, because the sweep limit held back the slide above it, may
	// reach the approach range near its top speed, as long as that speed is already an arrival pace.
	const ARRIVAL_ZOOM_PER_SECOND = 1.75;

	it('starts slowing high above the destination, unless it is already at an arrival pace', () => {
		for (const make of DESCENTS) {
			const descent = descentRates(make());
			const fastest = Math.max(...descent.map((frame) => frame.zoom));
			const entry = descent.find(
				(frame) => frame.rangeMeters < TRANSITION_POLICY.approachRangeMeters
			)!;

			expect(entry.zoom).toBeLessThan(Math.max(fastest * 0.75, ARRIVAL_ZOOM_PER_SECOND));
		}
	});

	it('crosses the scales below the approach range at a pace the eye can follow', () => {
		for (const make of DESCENTS) {
			for (const frame of descentRates(make())) {
				if (frame.rangeMeters < TRANSITION_POLICY.approachRangeMeters) {
					expect(frame.zoom).toBeLessThan(2);
					expect(frame.tiltDegrees).toBeLessThan(30);
				}
			}
		}
	});

	it('keeps slowing from the fastest moment of the descent to the summit', () => {
		for (const make of Object.values(JOURNEYS)) {
			const descent = descentRates(make());
			const zoomPeak = descent.findIndex(
				(frame) => frame.zoom === Math.max(...descent.map(({ zoom }) => zoom))
			);
			const tiltPeak = descent.findIndex(
				(frame) => frame.tiltDegrees === Math.max(...descent.map(({ tiltDegrees }) => tiltDegrees))
			);

			// The travel slowdown fades as the arrival slowdown grows; where they meet, the zoom may
			// hold its pace within a few percent, far below a speed change the eye can notice.
			let slowest = descent[zoomPeak]!.zoom;
			for (let index = zoomPeak + 1; index < descent.length; index += 1) {
				expect(descent[index]!.zoom - slowest).toBeLessThan(0.05);
				slowest = Math.min(slowest, descent[index]!.zoom);
			}
			let gentlest = descent[tiltPeak]!.tiltDegrees;
			for (let index = tiltPeak + 1; index < descent.length; index += 1) {
				expect(descent[index]!.tiltDegrees - gentlest).toBeLessThan(0.5);
				gentlest = Math.min(gentlest, descent[index]!.tiltDegrees);
			}
		}
	});
});

describe('glide orientation', () => {
	it('turns the heading once, the short way, with no intermediate bearing', () => {
		for (const make of Object.values(JOURNEYS)) {
			const plan = make();
			const direct = headingStep(plan.from.headingDegrees, plan.to.headingDegrees);
			const headings = grid(500).map((fraction) => sampleGlide(plan, fraction).headingDegrees);
			let travelled = 0;
			for (let index = 1; index < headings.length; index += 1) {
				const step = headingStep(headings[index - 1]!, headings[index]!);

				expect(step * Math.sign(direct)).toBeGreaterThanOrEqual(-1e-9);
				travelled += Math.abs(step);
			}
			expect(travelled).toBeCloseTo(Math.abs(direct), 6);
		}
	});

	it('turns mostly while the camera is high, not around the mountain being left', () => {
		for (const make of [JOURNEYS.regional, JOURNEYS.intercontinental, JOURNEYS.fromAtlas]) {
			const plan = make();
			const direct = Math.abs(headingStep(plan.from.headingDegrees, plan.to.headingDegrees));
			const halfTurned = grid(1000)
				.map((fraction) => sampleGlide(plan, fraction))
				.find(
					(frame) =>
						Math.abs(headingStep(plan.from.headingDegrees, frame.headingDegrees)) >= direct / 2
				)!;
			const lowest = Math.min(plan.from.rangeMeters, plan.to.rangeMeters);

			expect(halfTurned.rangeMeters).toBeGreaterThan(lowest * 20);
		}
	});

	it('keeps the heading still at the very start of the climb', () => {
		const plan = JOURNEYS.regional();
		const early = sampleGlide(plan, 0.1);

		expect(Math.abs(headingStep(plan.from.headingDegrees, early.headingDegrees))).toBeLessThan(5);
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

function toDegrees(radians: number): number {
	return (radians * 180) / Math.PI;
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
