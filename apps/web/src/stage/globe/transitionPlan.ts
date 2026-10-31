import { glideRangeAt, type GlidePlan, type LookState, type TransitionClass } from './glidePath';
import { greatCircleDistanceMeters, greatCirclePoint, initialBearingDegrees } from './geodesic';
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
	reveal: {
		durationSeconds: 3.4,
		lingerExponent: 1.5
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
		ascentFraction: 0.45,
		minPeakRangeGain: 1.25,
		minDurationSeconds: 1.5,
		maxDurationSeconds: 2.8,
		durationReferenceMeters: 100_000,
		durationSecondsPerDecade: 0.55,
		longHaulStartMeters: 5_000_000,
		longHaulFullMeters: 12_000_000,
		longHaulAscentFraction: 0.4,
		longHaulLingerExponent: 2.0
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

function longHaulWeight(distanceMeters: number): number {
	const { longHaulStartMeters, longHaulFullMeters } = TRANSITION_POLICY.explore;
	return smoothstepLog(distanceMeters, longHaulStartMeters, longHaulFullMeters);
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

export function exploreDurationSeconds(distanceMeters: number): number {
	const {
		minDurationSeconds,
		maxDurationSeconds,
		durationReferenceMeters,
		durationSecondsPerDecade
	} = TRANSITION_POLICY.explore;
	if (!(distanceMeters > durationReferenceMeters)) {
		return minDurationSeconds;
	}
	const decades = Math.log10(distanceMeters / durationReferenceMeters);
	return clamp(
		minDurationSeconds + durationSecondsPerDecade * decades,
		minDurationSeconds,
		maxDurationSeconds
	);
}

export function exploreAscentFraction(distanceMeters: number): number {
	const { ascentFraction, longHaulAscentFraction } = TRANSITION_POLICY.explore;
	return (
		ascentFraction + (longHaulAscentFraction - ascentFraction) * longHaulWeight(distanceMeters)
	);
}

export function exploreLingerExponent(distanceMeters: number): number {
	const { longHaulLingerExponent } = TRANSITION_POLICY.explore;
	return 1 + (longHaulLingerExponent - 1) * longHaulWeight(distanceMeters);
}

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

function heightOf(rangeMeters: number, pitchDegrees: number): number {
	return rangeMeters * Math.abs(Math.sin((pitchDegrees * Math.PI) / 180));
}

function withPhases(plan: Omit<GlidePlan, 'phases'>): GlidePlan {
	const provisional: GlidePlan = {
		...plan,
		phases: [
			{ name: 'context', startFraction: 0, endFraction: 1 },
			{ name: 'approach', startFraction: 1, endFraction: 1 }
		]
	};
	let approach = plan.ascentFraction;
	if (glideRangeAt(provisional, approach) > TRANSITION_POLICY.approachRangeMeters) {
		let low = plan.ascentFraction;
		let high = 1;
		for (let step = 0; step < APPROACH_SEARCH_STEPS; step += 1) {
			const middle = (low + high) / 2;
			if (glideRangeAt(provisional, middle) > TRANSITION_POLICY.approachRangeMeters) {
				low = middle;
			} else {
				high = middle;
			}
		}
		approach = high;
	}
	return {
		...plan,
		phases: [
			{ name: 'context', startFraction: 0, endFraction: approach },
			{ name: 'approach', startFraction: approach, endFraction: 1 }
		]
	};
}

export function planFreshApproach(
	destination: LookState,
	motion: MotionPreference
): TransitionPlan {
	if (motion === 'direct') {
		return { mode: 'direct' };
	}
	const from = globeLook(destination);
	return {
		mode: 'glide',
		...withPhases({
			journey: 'reveal',
			transitionClass: undefined,
			distanceMeters: 0,
			durationSeconds: TRANSITION_POLICY.reveal.durationSeconds,
			from,
			to: destination,
			peak: {
				rangeMeters: from.rangeMeters,
				heightMeters: heightOf(from.rangeMeters, from.pitchDegrees),
				headingDegrees: from.headingDegrees,
				pitchDegrees: from.pitchDegrees,
				framingX: from.framingX,
				framingY: from.framingY
			},
			ascentFraction: 0,
			lingerExponent: TRANSITION_POLICY.reveal.lingerExponent,
			sweepWeight: 0
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
	const policy = TRANSITION_POLICY.explore;
	const peakHeightMeters = explorePeakHeightMeters(distanceMeters);
	const peakPitchDegrees = explorePeakPitchDegrees(peakHeightMeters);
	const peakRangeMeters = peakHeightMeters / Math.abs(Math.sin((peakPitchDegrees * Math.PI) / 180));
	const ascends = peakRangeMeters > origin.rangeMeters * policy.minPeakRangeGain;

	const midpoint = greatCirclePoint(origin, destination, 0.5);
	const routeHeadingDegrees =
		distanceMeters > 1 ? initialBearingDegrees(midpoint, destination) : origin.headingDegrees;

	return {
		mode: 'glide',
		...withPhases({
			journey: 'explore',
			transitionClass: classifyTransition(distanceMeters),
			distanceMeters,
			durationSeconds: exploreDurationSeconds(distanceMeters),
			from: origin,
			to: destination,
			peak: ascends
				? {
						rangeMeters: peakRangeMeters,
						heightMeters: peakHeightMeters,
						headingDegrees: routeHeadingDegrees,
						pitchDegrees: peakPitchDegrees,
						framingX: 0,
						framingY: 0
					}
				: {
						rangeMeters: origin.rangeMeters,
						heightMeters: heightOf(origin.rangeMeters, origin.pitchDegrees),
						headingDegrees: origin.headingDegrees,
						pitchDegrees: origin.pitchDegrees,
						framingX: origin.framingX,
						framingY: origin.framingY
					},
			ascentFraction: ascends ? exploreAscentFraction(distanceMeters) : 0,
			lingerExponent: exploreLingerExponent(distanceMeters),
			sweepWeight: longHaulWeight(distanceMeters)
		})
	};
}
