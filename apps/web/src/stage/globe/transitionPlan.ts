import {
	glidePeakFraction,
	glideRangeAt,
	timeGlide,
	type GlidePace,
	type GlidePlan,
	type GlideShape,
	type LookState,
	type TimedGlide,
	type TransitionClass
} from './glidePath';
import { greatCircleDistanceMeters } from './geodesic';
import { SUMMIT_MARKER_STYLE } from './marker';

export type MotionPreference = 'full' | 'direct';

export function motionPreference(reducedMotion: boolean): MotionPreference {
	return reducedMotion ? 'direct' : 'full';
}

export type TransitionPlan = { mode: 'direct' } | ({ mode: 'glide' } & GlidePlan);

export const TRANSITION_POLICY = {
	globe: {
		rangeMeters: 16_000_000,
		pitchDegrees: -89,
		headingDegrees: 0
	},
	/**
	 * The base pace of a glide, from its perceived length: the zoom in factors of e, plus the
	 * ground slid past in camera ranges, plus the turn and tilt. Distance alone would rush a
	 * shallow-looking hop that still zooms from the whole globe down to a summit.
	 */
	pace: {
		baseSeconds: 1.6,
		perceivedLengthPerSecond: 3.8,
		minSeconds: 2.2,
		maxSeconds: 7
	},
	/**
	 * Extra time for each unit of perceived length the descent covers near the destination's
	 * scale: in full within the approach range, easing in from `rampFactor` times it. It brings
	 * the zoom into the last scales down to well under half the base pace, so the camera slows
	 * from high above the summit rather than only in its last second.
	 */
	arrival: {
		secondsPerLength: 0.25,
		rampFactor: 12
	},
	/**
	 * The fastest the slide runs, in units of perceived length per second: about 65° of view per
	 * second, or a whole-globe turn of about 60° per second near the top of a long route. Stretches
	 * that would slide faster are slowed; the rest of the glide keeps its pace.
	 */
	sweep: {
		maxSlidePerSecond: 1.8
	},
	reveal: {
		// A slow start lets the globe hold for a beat before the descent.
		ease: { rise: 2, settle: 2 }
	},
	explore: {
		localMaxMeters: 400_000,
		regionalMaxMeters: 2_000_000,
		continentalMaxMeters: 6_000_000,
		peakHeightPerDistance: 0.8,
		maxPeakHeightMeters: 9_000_000,
		nearbyBaseHeightMeters: 9_000,
		nearbyHeightPerDistance: 0.35,
		nearbyBlendStartMeters: 40_000,
		nearbyBlendEndMeters: 400_000,
		shallowPeakPitchDegrees: -50,
		steepPeakPitchDegrees: -89,
		shallowPeakHeightMeters: 30_000,
		steepPeakHeightMeters: 3_000_000,
		nearbyPitchLiftDegrees: 22,
		nearbyPitchLiftFullHeightMeters: 12_000,
		nearbyPitchLiftEndHeightMeters: 200_000,
		minPeakRangeGain: 1.25,
		// The arrival settles longer than the departure rises, so the last approach stays legible.
		ease: { rise: 1.5, settle: 2.2 }
	},
	approachRangeMeters: SUMMIT_MARKER_STYLE.maxDistanceMeters
} as const;

const APPROACH_SEARCH_STEPS = 40;

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function smoothstepLog(value: number, start: number, end: number): number {
	if (!(value > start)) {
		return 0;
	}
	const t = clamp(Math.log(value / start) / Math.log(end / start), 0, 1);
	return t * t * (3 - 2 * t);
}

export function classifyTransition(distanceMeters: number): TransitionClass {
	const { localMaxMeters, regionalMaxMeters, continentalMaxMeters } = TRANSITION_POLICY.explore;
	if (distanceMeters < localMaxMeters) {
		return 'local';
	}
	if (distanceMeters < regionalMaxMeters) {
		return 'regional';
	}
	if (distanceMeters < continentalMaxMeters) {
		return 'continental';
	}
	return 'intercontinental';
}

export function explorePeakHeightMeters(distanceMeters: number): number {
	const {
		peakHeightPerDistance,
		maxPeakHeightMeters,
		nearbyBaseHeightMeters,
		nearbyHeightPerDistance,
		nearbyBlendStartMeters,
		nearbyBlendEndMeters
	} = TRANSITION_POLICY.explore;
	if (!Number.isFinite(distanceMeters)) {
		return nearbyBaseHeightMeters;
	}
	const distance = Math.max(0, distanceMeters);
	const regional = Math.min(maxPeakHeightMeters, distance * peakHeightPerDistance);
	const nearby = nearbyBaseHeightMeters + distance * nearbyHeightPerDistance;
	const regionalWeight = smoothstepLog(distance, nearbyBlendStartMeters, nearbyBlendEndMeters);
	return nearby + (regional - nearby) * regionalWeight;
}

export function explorePeakPitchDegrees(peakHeightMeters: number): number {
	const {
		shallowPeakPitchDegrees,
		steepPeakPitchDegrees,
		shallowPeakHeightMeters,
		steepPeakHeightMeters,
		nearbyPitchLiftDegrees,
		nearbyPitchLiftFullHeightMeters,
		nearbyPitchLiftEndHeightMeters
	} = TRANSITION_POLICY.explore;
	const span = Math.log(steepPeakHeightMeters / shallowPeakHeightMeters);
	const t = clamp(Math.log(peakHeightMeters / shallowPeakHeightMeters) / span, 0, 1);
	const regionalPitch =
		shallowPeakPitchDegrees + (steepPeakPitchDegrees - shallowPeakPitchDegrees) * t;
	const lift =
		nearbyPitchLiftDegrees *
		(1 -
			smoothstepLog(
				peakHeightMeters,
				nearbyPitchLiftFullHeightMeters,
				nearbyPitchLiftEndHeightMeters
			));
	return regionalPitch + lift;
}

export function glideBaseSeconds(perceivedLength: number): number {
	const { baseSeconds, perceivedLengthPerSecond, minSeconds, maxSeconds } = TRANSITION_POLICY.pace;
	if (!Number.isFinite(perceivedLength) || !(perceivedLength > 0)) {
		return minSeconds;
	}
	return clamp(baseSeconds + perceivedLength / perceivedLengthPerSecond, minSeconds, maxSeconds);
}

const GLIDE_PACE: GlidePace = {
	baseSeconds: glideBaseSeconds,
	arrival: {
		rangeMeters: TRANSITION_POLICY.approachRangeMeters,
		...TRANSITION_POLICY.arrival
	},
	sweep: TRANSITION_POLICY.sweep
};

export function globeLook(
	destination: Pick<LookState, 'latitude' | 'longitude' | 'altitudeMeters'>
): LookState {
	return {
		latitude: destination.latitude,
		longitude: destination.longitude,
		altitudeMeters: destination.altitudeMeters,
		headingDegrees: TRANSITION_POLICY.globe.headingDegrees,
		pitchDegrees: TRANSITION_POLICY.globe.pitchDegrees,
		rangeMeters: TRANSITION_POLICY.globe.rangeMeters,
		framingX: 0,
		framingY: 0
	};
}

function timedGlide(shape: GlideShape): GlidePlan {
	const timed = timeGlide(shape, GLIDE_PACE);
	const approach = approachFraction(timed);
	return {
		...timed,
		phases: [
			{ name: 'context', startFraction: 0, endFraction: approach },
			{ name: 'approach', startFraction: approach, endFraction: 1 }
		]
	};
}

// The first moment of the descent at which the camera is within the summit marker's range.
function approachFraction(plan: TimedGlide): number {
	const peak = glidePeakFraction(plan);
	if (!(glideRangeAt(plan, peak) > TRANSITION_POLICY.approachRangeMeters)) {
		return peak;
	}
	let low = peak;
	let high = 1;
	for (let step = 0; step < APPROACH_SEARCH_STEPS; step += 1) {
		const middle = (low + high) / 2;
		if (glideRangeAt(plan, middle) > TRANSITION_POLICY.approachRangeMeters) {
			low = middle;
		} else {
			high = middle;
		}
	}
	return high;
}

export function planFreshApproach(
	destination: LookState,
	motion: MotionPreference
): TransitionPlan {
	if (motion === 'direct') {
		return { mode: 'direct' };
	}
	return {
		mode: 'glide',
		...timedGlide({
			journey: 'reveal',
			transitionClass: undefined,
			distanceMeters: 0,
			from: globeLook(destination),
			to: destination,
			peak: undefined,
			ease: TRANSITION_POLICY.reveal.ease
		})
	};
}

export function planExploreTransition(
	origin: LookState | undefined,
	destination: LookState,
	motion: MotionPreference
): TransitionPlan {
	if (motion === 'direct' || !origin) {
		return { mode: 'direct' };
	}
	const distanceMeters = greatCircleDistanceMeters(origin, destination);
	const peakHeightMeters = explorePeakHeightMeters(distanceMeters);
	const peakPitchDegrees = explorePeakPitchDegrees(peakHeightMeters);
	const peakRangeMeters = peakHeightMeters / Math.abs(Math.sin((peakPitchDegrees * Math.PI) / 180));
	const ascends = peakRangeMeters > origin.rangeMeters * TRANSITION_POLICY.explore.minPeakRangeGain;

	return {
		mode: 'glide',
		...timedGlide({
			journey: 'explore',
			transitionClass: classifyTransition(distanceMeters),
			distanceMeters,
			from: origin,
			to: destination,
			peak: ascends
				? {
						rangeMeters: peakRangeMeters,
						heightMeters: peakHeightMeters,
						pitchDegrees: peakPitchDegrees
					}
				: undefined,
			ease: TRANSITION_POLICY.explore.ease
		})
	};
}
