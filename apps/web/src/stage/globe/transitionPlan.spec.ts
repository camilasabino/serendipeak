import { describe, expect, it } from 'vitest';
import { greatCircleDistanceMeters } from './geodesic';
import {
	glidePeakFraction,
	glideRangeAt,
	sampleGlide,
	type GlidePeak,
	type GlidePlan,
	type LookState
} from './glidePath';
import { SUMMIT_MARKER_STYLE } from './marker';
import {
	TRANSITION_POLICY,
	classifyTransition,
	explorePeakHeightMeters,
	explorePeakPitchDegrees,
	glideBaseSeconds,
	globeLook,
	motionPreference,
	planExploreTransition,
	planFreshApproach,
	type TransitionPlan
} from './transitionPlan';

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

function lookAt(
	latitude: number,
	longitude: number,
	overrides: Partial<LookState> = {}
): LookState {
	return {
		latitude,
		longitude,
		altitudeMeters: 3000,
		headingDegrees: 90,
		pitchDegrees: -20,
		rangeMeters: 13_000,
		framingX: 0,
		framingY: 0.3,
		...overrides
	};
}

function glidePlan(plan: TransitionPlan): GlidePlan {
	if (plan.mode !== 'glide') {
		throw new Error('expected a glide plan');
	}
	return plan;
}

function peakOf(plan: GlidePlan): GlidePeak {
	if (!plan.peak) {
		throw new Error('expected a climbing glide');
	}
	return plan.peak;
}

function planAtDistance(kilometers: number): GlidePlan {
	const origin = lookAt(0, 0);
	const destination = lookAt(0, (kilometers * 1000) / ((Math.PI * 6_371_008.8) / 180));
	return glidePlan(planExploreTransition(origin, destination, 'full'));
}

// The most the arrival slowdown adds to the base pace: a descent from orbit down to a summit.
const ARRIVAL_ALLOWANCE_SECONDS = 1.5;
// The most the sweep limit adds: the globe turning half a revolution on a near-antipodal route.
const SWEEP_ALLOWANCE_SECONDS = 2.5;
const EXTRA_ALLOWANCE_SECONDS = ARRIVAL_ALLOWANCE_SECONDS + SWEEP_ALLOWANCE_SECONDS;

const DISTANCES_KM = [
	0, 1, 15, 100, 399, 400, 1_000, 1_999, 2_000, 5_999, 6_000, 10_000, 15_000, 19_900
];

describe('motionPreference', () => {
	it('plays the full choreography unless the visitor prefers reduced motion', () => {
		expect(motionPreference(false)).toBe('full');
	});

	it('places directly for reduced motion', () => {
		expect(motionPreference(true)).toBe('direct');
	});
});

describe('classifyTransition', () => {
	it.each([
		[0, 'local'],
		[15_000, 'local'],
		[399_000, 'local'],
		[400_000, 'regional'],
		[1_999_000, 'regional'],
		[2_000_000, 'continental'],
		[5_999_000, 'continental'],
		[6_000_000, 'intercontinental'],
		[19_900_000, 'intercontinental']
	] as const)('classifies %d m as %s', (meters, expected) => {
		expect(classifyTransition(meters)).toBe(expected);
	});
});

describe('explore peak height', () => {
	it('never shrinks as the distance grows', () => {
		const heights = DISTANCES_KM.map((km) => explorePeakHeightMeters(km * 1000));

		for (let index = 1; index < heights.length; index += 1) {
			expect(heights[index]).toBeGreaterThanOrEqual(heights[index - 1]!);
		}
	});

	it('stays positive, finite and within the policy bounds', () => {
		const { nearbyBaseHeightMeters, maxPeakHeightMeters } = TRANSITION_POLICY.explore;
		for (const km of DISTANCES_KM) {
			const height = explorePeakHeightMeters(km * 1000);
			expect(Number.isFinite(height)).toBe(true);
			expect(height).toBeGreaterThanOrEqual(nearbyBaseHeightMeters);
			expect(height).toBeLessThanOrEqual(maxPeakHeightMeters);
		}
		expect(explorePeakHeightMeters(Number.NaN)).toBe(nearbyBaseHeightMeters);
	});

	it('keeps near jumps local and long jumps global', () => {
		expect(explorePeakHeightMeters(15_000)).toBeLessThanOrEqual(20_000);
		expect(explorePeakHeightMeters(63_000)).toBeLessThanOrEqual(40_000);
		expect(explorePeakHeightMeters(400_000)).toBeLessThan(500_000);
		expect(explorePeakHeightMeters(12_000_000)).toBeGreaterThanOrEqual(6_000_000);
		expect(explorePeakHeightMeters(20_000_000)).toBeLessThanOrEqual(10_000_000);
	});

	it('keeps the regional and larger law unchanged from the local blend end onward', () => {
		for (const km of [400, 993, 2_000, 4_915, 10_000]) {
			expect(explorePeakHeightMeters(km * 1000)).toBeCloseTo(
				Math.min(TRANSITION_POLICY.explore.maxPeakHeightMeters, km * 1000 * 0.8),
				3
			);
		}
	});

	it('grows smoothly through the nearby blend without a jump at the local limit', () => {
		let previous = explorePeakHeightMeters(1_000);
		for (let km = 2; km <= 1_000; km *= 1.02) {
			const height = explorePeakHeightMeters(km * 1000);

			expect(height).toBeGreaterThanOrEqual(previous);
			expect(height / previous).toBeLessThan(1.06);
			previous = height;
		}
		const justBelow = explorePeakHeightMeters(399_000);
		const justAbove = explorePeakHeightMeters(401_000);
		expect(justAbove / justBelow).toBeLessThan(1.02);
	});

	it('tilts the peak view from oblique to nadir as the peak rises', () => {
		const { steepPeakPitchDegrees, nearbyPitchLiftDegrees, shallowPeakPitchDegrees } =
			TRANSITION_POLICY.explore;

		expect(explorePeakPitchDegrees(1)).toBe(shallowPeakPitchDegrees + nearbyPitchLiftDegrees);
		expect(explorePeakPitchDegrees(9_000_000)).toBe(steepPeakPitchDegrees);
		expect(explorePeakPitchDegrees(300_000)).toBeLessThan(shallowPeakPitchDegrees);
		expect(explorePeakPitchDegrees(300_000)).toBeGreaterThan(steepPeakPitchDegrees);
	});

	it('keeps nearby peaks more oblique than regional ones and fades into the regional curve', () => {
		const heights = [10_000, 20_000, 40_000, 80_000, 150_000, 300_000, 800_000, 3_000_000];
		const pitches = heights.map(explorePeakPitchDegrees);

		for (let index = 1; index < pitches.length; index += 1) {
			expect(pitches[index]).toBeLessThanOrEqual(pitches[index - 1]!);
			expect(pitches[index - 1]! - pitches[index]!).toBeLessThan(20);
		}
		expect(explorePeakPitchDegrees(14_000)).toBeGreaterThan(-35);
		expect(explorePeakPitchDegrees(33_000)).toBeGreaterThan(-45);
		expect(explorePeakPitchDegrees(795_000)).toBeCloseTo(-77.8, 0);
	});
});

describe('glide duration', () => {
	const { minSeconds, maxSeconds } = TRANSITION_POLICY.pace;

	it('keeps the base pace inside its bounds for every perceived length', () => {
		for (const length of [0, 0.5, 2, 8, 15, 40, 1_000]) {
			const seconds = glideBaseSeconds(length);
			expect(seconds).toBeGreaterThanOrEqual(minSeconds);
			expect(seconds).toBeLessThanOrEqual(maxSeconds);
		}
		expect(glideBaseSeconds(Number.NaN)).toBe(minSeconds);
		expect(glideBaseSeconds(-1)).toBe(minSeconds);
	});

	it('grows the base pace with the perceived length', () => {
		let previous = 0;
		for (let length = 0; length <= 30; length += 0.5) {
			const seconds = glideBaseSeconds(length);
			expect(seconds).toBeGreaterThanOrEqual(previous);
			previous = seconds;
		}
		expect(glideBaseSeconds(12)).toBeGreaterThan(glideBaseSeconds(6));
	});

	it('plans every distance within the bounds and longer for longer routes', () => {
		const seconds = DISTANCES_KM.map((km) => planAtDistance(km).durationSeconds);

		for (const value of seconds) {
			expect(value).toBeGreaterThanOrEqual(minSeconds);
			expect(value).toBeLessThanOrEqual(maxSeconds + EXTRA_ALLOWANCE_SECONDS);
		}
		for (let index = 1; index < seconds.length; index += 1) {
			expect(seconds[index]).toBeGreaterThanOrEqual(seconds[index - 1]! - 0.05);
		}
	});

	it('adds the arrival and the sweep limit on top of the base pace, in proportion to the route', () => {
		const extra = (plan: GlidePlan) =>
			plan.durationSeconds - glideBaseSeconds(plan.profile.perceivedLength);
		const extras = DISTANCES_KM.map((km) => extra(planAtDistance(km)));

		for (const value of extras) {
			expect(value).toBeGreaterThan(0);
			expect(value).toBeLessThanOrEqual(EXTRA_ALLOWANCE_SECONDS);
		}
		expect(extra(planAtDistance(15))).toBeLessThan(0.4);
		expect(extra(planAtDistance(15_000))).toBeGreaterThan(1);
	});

	it('gives each class of journey a deliberate, distinct duration', () => {
		const nearby = planAtDistance(15).durationSeconds;
		const regional = planAtDistance(1_000).durationSeconds;
		const continental = planAtDistance(4_500).durationSeconds;
		const intercontinental = planAtDistance(15_000).durationSeconds;

		expect(nearby).toBeLessThan(2.8);
		expect(regional).toBeGreaterThan(4);
		expect(regional).toBeLessThan(6);
		expect(continental).toBeGreaterThan(regional);
		expect(intercontinental).toBeGreaterThan(continental);
		expect(intercontinental).toBeGreaterThan(6.5);
	});

	it('counts the zoom from a whole-globe view, not only the ground distance', () => {
		const overview = lookAt(0, 0, {
			rangeMeters: 18_000_000,
			pitchDegrees: -89,
			headingDegrees: 0,
			framingY: 0
		});
		const fromGlobe = glidePlan(planExploreTransition(overview, lookAt(0, 3), 'full'));
		const fromNearby = glidePlan(planExploreTransition(lookAt(0, 0), lookAt(0, 3), 'full'));

		expect(fromGlobe.durationSeconds).toBeGreaterThan(3.5);
		expect(fromGlobe.durationSeconds).toBeGreaterThan(fromNearby.durationSeconds);
	});

	it('gives a larger turn of the heading more time', () => {
		const straight = glidePlan(planExploreTransition(lookAt(0, 0), lookAt(0, 0.2), 'full'));
		const turning = glidePlan(
			planExploreTransition(lookAt(0, 0), lookAt(0, 0.2, { headingDegrees: 270 }), 'full')
		);

		expect(turning.durationSeconds).toBeGreaterThan(straight.durationSeconds);
	});
});

describe('planFreshApproach', () => {
	it('resolves directly to the final pose when motion is reduced', () => {
		expect(planFreshApproach(ACONCAGUA, 'direct')).toEqual({ mode: 'direct' });
	});

	it('plans a globe-first approach with context and approach phases', () => {
		const plan = glidePlan(planFreshApproach(ACONCAGUA, 'full'));

		expect(plan.journey).toBe('reveal');
		expect(plan.transitionClass).toBeUndefined();
		expect(plan.peak).toBeUndefined();
		expect(plan.ease).toEqual(TRANSITION_POLICY.reveal.ease);
		expect(plan.durationSeconds).toBeGreaterThanOrEqual(4);
		expect(plan.durationSeconds).toBeLessThanOrEqual(5.5);
		expect(plan.phases.map((phase) => phase.name)).toEqual(['context', 'approach']);
		expect(plan.phases[0].startFraction).toBe(0);
		expect(plan.phases[0].endFraction).toBe(plan.phases[1].startFraction);
		expect(plan.phases[1].endFraction).toBe(1);
		expect(plan.phases[0].endFraction).toBeGreaterThan(0.2);
		expect(plan.phases[0].endFraction).toBeLessThan(0.8);
	});

	it('starts on a globe view above the target with Earth curvature visible', () => {
		const plan = glidePlan(planFreshApproach(ACONCAGUA, 'full'));
		const globe = globeLook(ACONCAGUA);

		expect(plan.from).toEqual(globe);
		expect(globe.latitude).toBe(ACONCAGUA.latitude);
		expect(globe.longitude).toBe(ACONCAGUA.longitude);
		expect(globe.rangeMeters).toBeGreaterThanOrEqual(12_000_000);
		expect(globe.rangeMeters).toBeLessThanOrEqual(20_000_000);
		expect(globe.pitchDegrees).toBeLessThanOrEqual(-85);
		expect(globe.headingDegrees).toBe(0);
		expect(globe.framingX).toBe(0);
		expect(globe.framingY).toBe(0);
	});

	it('lands on the exact curated destination, framing and positive pitch included', () => {
		for (const destination of [ACONCAGUA, EVEREST]) {
			const plan = glidePlan(planFreshApproach(destination, 'full'));
			const landing = sampleGlide(plan, 1);

			expect(plan.to).toBe(destination);
			expect(landing).toEqual({ ...destination, routeFraction: 1 });
		}
		expect(EVEREST.pitchDegrees).toBeGreaterThan(0);
	});

	it('switches to the approach phase at the marker display range', () => {
		const plan = glidePlan(planFreshApproach(ACONCAGUA, 'full'));
		const boundary = plan.phases[1].startFraction;

		expect(glideRangeAt(plan, boundary)).toBeCloseTo(SUMMIT_MARKER_STYLE.maxDistanceMeters, -1);
		expect(glideRangeAt(plan, boundary - 0.01)).toBeGreaterThan(
			SUMMIT_MARKER_STYLE.maxDistanceMeters
		);
	});

	it('reserves a substantial share of the time for the descent into the region', () => {
		const plan = glidePlan(planFreshApproach(ACONCAGUA, 'full'));

		expect(1 - plan.phases[1].startFraction).toBeGreaterThanOrEqual(0.35);
	});
});

describe('planExploreTransition', () => {
	it('keeps a ~60 km jump low and oblique, yet above the 15 km one', () => {
		const nearest = planAtDistance(15);
		const plan = planAtDistance(63);

		expect(peakOf(plan).heightMeters).toBeLessThan(40_000);
		expect(peakOf(plan).pitchDegrees).toBeGreaterThan(-45);
		expect(peakOf(plan).heightMeters).toBeGreaterThan(peakOf(nearest).heightMeters);
		expect(peakOf(plan).pitchDegrees).toBeLessThanOrEqual(peakOf(nearest).pitchDegrees);
	});

	it('moves from local to regional framing without a threshold jump', () => {
		const below = planAtDistance(399);
		const above = planAtDistance(400);

		expect(peakOf(above).heightMeters / peakOf(below).heightMeters).toBeLessThan(1.02);
		expect(Math.abs(peakOf(above).pitchDegrees - peakOf(below).pitchDegrees)).toBeLessThan(0.5);
	});

	it('resolves directly when motion is reduced', () => {
		expect(planExploreTransition(ACONCAGUA, EVEREST, 'direct')).toEqual({ mode: 'direct' });
	});

	it('resolves directly when the origin view is unknown', () => {
		expect(planExploreTransition(undefined, EVEREST, 'full')).toEqual({ mode: 'direct' });
	});

	it('plans every distance with finite, positive, bounded values', () => {
		for (const km of DISTANCES_KM) {
			const plan = planAtDistance(km);

			const peak = peakOf(plan);

			expect(peak.heightMeters).toBeGreaterThan(0);
			expect(peak.rangeMeters).toBeGreaterThan(0);
			expect(peak.heightMeters).toBeLessThanOrEqual(TRANSITION_POLICY.explore.maxPeakHeightMeters);
			expect(plan.durationSeconds).toBeLessThanOrEqual(
				TRANSITION_POLICY.pace.maxSeconds + EXTRA_ALLOWANCE_SECONDS
			);
			expect(Number.isFinite(peak.pitchDegrees)).toBe(true);
			expect(Number.isFinite(plan.profile.perceivedLength)).toBe(true);
			expect(plan.phases[0].endFraction).toBeGreaterThanOrEqual(0);
			expect(plan.phases[0].endFraction).toBeLessThanOrEqual(1);
			expect(plan.phases[0].endFraction).toBe(plan.phases[1].startFraction);
		}
	});

	it('raises the peak monotonically with the great-circle distance', () => {
		const ranges = DISTANCES_KM.map((km) => peakOf(planAtDistance(km)).rangeMeters);

		for (let index = 1; index < ranges.length; index += 1) {
			expect(ranges[index]).toBeGreaterThanOrEqual(ranges[index - 1]!);
		}
	});

	it('keeps a nearby jump local without a globe-scale reveal', () => {
		const plan = planAtDistance(15);

		expect(plan.transitionClass).toBe('local');
		expect(peakOf(plan).heightMeters).toBeLessThan(20_000);
		expect(peakOf(plan).rangeMeters).toBeLessThan(40_000);
		expect(peakOf(plan).pitchDegrees).toBeGreaterThan(-35);
		expect(peakOf(plan).pitchDegrees).toBeLessThan(-15);
		expect(glideBaseSeconds(plan.profile.perceivedLength)).toBe(TRANSITION_POLICY.pace.minSeconds);
		expect(plan.durationSeconds).toBeLessThan(TRANSITION_POLICY.pace.minSeconds + 0.4);
	});

	it('gives a regional jump legible regional context', () => {
		const plan = planAtDistance(1_000);

		expect(plan.transitionClass).toBe('regional');
		expect(peakOf(plan).heightMeters).toBeGreaterThan(500_000);
		expect(peakOf(plan).heightMeters).toBeLessThan(1_500_000);
	});

	it('lifts a continental jump well above regional', () => {
		const plan = planAtDistance(4_500);

		expect(plan.transitionClass).toBe('continental');
		expect(peakOf(plan).heightMeters).toBeGreaterThan(
			peakOf(planAtDistance(1_000)).heightMeters * 2
		);
	});

	it('gives an intercontinental jump a globe-scale nadir peak', () => {
		const plan = planAtDistance(12_000);

		expect(plan.transitionClass).toBe('intercontinental');
		expect(peakOf(plan).heightMeters).toBeGreaterThanOrEqual(6_000_000);
		expect(peakOf(plan).pitchDegrees).toBe(TRANSITION_POLICY.explore.steepPeakPitchDegrees);
	});

	it('caps the peak for a near-antipodal route', () => {
		const plan = planAtDistance(19_900);

		expect(peakOf(plan).heightMeters).toBe(TRANSITION_POLICY.explore.maxPeakHeightMeters);
		expect(plan.durationSeconds).toBeLessThanOrEqual(
			TRANSITION_POLICY.pace.maxSeconds + EXTRA_ALLOWANCE_SECONDS
		);
		expect(plan.distanceMeters).toBeGreaterThan(19_800_000);
	});

	it('measures the distance between the origin and destination foci', () => {
		const plan = glidePlan(planExploreTransition(ACONCAGUA, EVEREST, 'full'));

		expect(plan.distanceMeters).toBeCloseTo(greatCircleDistanceMeters(ACONCAGUA, EVEREST), 3);
		expect(plan.transitionClass).toBe('intercontinental');
	});

	it('lands exactly on the destination for every distance class', () => {
		for (const km of [15, 1_000, 4_500, 12_000]) {
			const plan = planAtDistance(km);

			expect(sampleGlide(plan, 1)).toEqual({ ...plan.to, routeFraction: 1 });
			expect(sampleGlide(plan, 0).rangeMeters).toBeCloseTo(plan.from.rangeMeters, 6);
		}
	});

	it('keeps the marker out of the context phase, including the climb and the peak', () => {
		for (const km of [15, 1_000, 12_000]) {
			const plan = planAtDistance(km);

			expect(plan.phases[1].startFraction).toBeGreaterThanOrEqual(glidePeakFraction(plan));
			expect(plan.phases[1].startFraction).toBeGreaterThan(0);
		}
	});

	it('skips the climb when the origin view is already above the planned peak', () => {
		const high = lookAt(0, 0, { rangeMeters: 30_000_000, pitchDegrees: -89 });
		const plan = glidePlan(planExploreTransition(high, lookAt(0, 20), 'full'));

		expect(plan.peak).toBeUndefined();
		expect(glidePeakFraction(plan)).toBe(0);
		expect(sampleGlide(plan, 0).rangeMeters).toBeCloseTo(high.rangeMeters, 3);
	});

	it('plans from a mid-air origin to the latest destination', () => {
		const midAir = lookAt(10, 20, { rangeMeters: 2_500_000, pitchDegrees: -60, framingY: 0 });
		const plan = glidePlan(planExploreTransition(midAir, EVEREST, 'full'));

		expect(plan.from).toEqual(midAir);
		expect(plan.to).toBe(EVEREST);
		expect(sampleGlide(plan, 1).pitchDegrees).toBeGreaterThan(0);
	});
});
