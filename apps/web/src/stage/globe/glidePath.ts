import {
	cameraOffsetFromPose,
	lookAxesForFraming,
	type LookAxes,
	type SummitOffset
} from './framing';
import { greatCirclePoint } from './geodesic';

export interface LookState {
	latitude: number;
	longitude: number;
	altitudeMeters: number;
	headingDegrees: number;
	pitchDegrees: number;
	rangeMeters: number;
	framingX: number;
	framingY: number;
}

export type TransitionJourney = 'reveal' | 'explore';
export type TransitionClass = 'local' | 'regional' | 'continental' | 'intercontinental';
export type GlidePhaseName = 'context' | 'approach';

export interface GlidePhase {
	name: GlidePhaseName;
	startFraction: number;
	endFraction: number;
}

export interface GlidePeak {
	rangeMeters: number;
	heightMeters: number;
	headingDegrees: number;
	pitchDegrees: number;
	framingX: number;
	framingY: number;
}

export interface GlidePlan {
	journey: TransitionJourney;
	transitionClass: TransitionClass | undefined;
	distanceMeters: number;
	durationSeconds: number;
	from: LookState;
	to: LookState;
	peak: GlidePeak;
	ascentFraction: number;
	lingerExponent: number;
	sweepWeight: number;
	phases: readonly [GlidePhase, GlidePhase];
}

export interface GlideFrame extends LookState {
	routeFraction: number;
}

export interface LookPose {
	cameraFromFocus: SummitOffset;
	axes: LookAxes;
}

const PEAK_ROUTE_FRACTION = 0.5;
const ROUTE_RANGE_POWER = 1.5;
const RANGE_EPSILON_METERS = 1e-6;
const SWEEP_RANGE_POWER = 1.0;
const SWEEP_INTEGRATION_STEPS = 96;

function clamp01(value: number): number {
	return Math.min(1, Math.max(0, value));
}

function smoothstep(value: number): number {
	const t = clamp01(value);
	return t * t * (3 - 2 * t);
}

function lerp(start: number, end: number, t: number): number {
	return start + (end - start) * t;
}

export function lerpAngleDegrees(start: number, end: number, t: number): number {
	const delta = ((((end - start + 180) % 360) + 360) % 360) - 180;
	return start + delta * t;
}

function routeProgress(range: number, startRange: number, endRange: number, fallback: number) {
	const span = endRange - startRange;
	if (Math.abs(span) < RANGE_EPSILON_METERS) {
		return fallback;
	}
	return clamp01((range - startRange) / span);
}

function climbShare(rangeProgress: number): number {
	return Math.pow(rangeProgress, ROUTE_RANGE_POWER);
}

function descentShare(rangeProgress: number): number {
	return 1 - Math.pow(1 - rangeProgress, ROUTE_RANGE_POWER);
}

interface GlideSample {
	rangeMeters: number;
	blend: number;
	ascending: boolean;
}

function sampleRange(plan: GlidePlan, fraction: number): GlideSample {
	const u = clamp01(fraction);
	const { from, to, peak, ascentFraction, lingerExponent } = plan;
	if (ascentFraction > 0 && u < ascentFraction) {
		const blend = 1 - Math.pow(1 - smoothstep(u / ascentFraction), lingerExponent);
		const logRange = lerp(Math.log(from.rangeMeters), Math.log(peak.rangeMeters), blend);
		return { rangeMeters: Math.exp(logRange), blend, ascending: true };
	}
	const span = 1 - ascentFraction;
	const blend = span > 0 ? Math.pow(smoothstep((u - ascentFraction) / span), lingerExponent) : 1;
	const logRange = lerp(Math.log(peak.rangeMeters), Math.log(to.rangeMeters), blend);
	return { rangeMeters: Math.exp(logRange), blend, ascending: false };
}

function sweepFraction(plan: GlidePlan, fraction: number): number {
	const integrate = (end: number) => {
		const step = end / SWEEP_INTEGRATION_STEPS;
		let sum = 0;
		for (let index = 0; index <= SWEEP_INTEGRATION_STEPS; index += 1) {
			const weight = index === 0 || index === SWEEP_INTEGRATION_STEPS ? 1 : index % 2 === 1 ? 4 : 2;
			sum += weight * Math.pow(sampleRange(plan, index * step).rangeMeters, SWEEP_RANGE_POWER);
		}
		return (sum * step) / 3;
	};
	const total = integrate(1);
	return total > 0 ? clamp01(integrate(clamp01(fraction)) / total) : clamp01(fraction);
}

export function glideRangeAt(plan: GlidePlan, fraction: number): number {
	return sampleRange(plan, fraction).rangeMeters;
}

export function sampleGlide(plan: GlidePlan, fraction: number): GlideFrame {
	const { from, to, peak, ascentFraction } = plan;
	const { rangeMeters, blend, ascending } = sampleRange(plan, fraction);

	let routeFraction: number;
	let headingDegrees: number;
	let pitchDegrees: number;
	let framingX: number;
	let framingY: number;

	if (ascending) {
		routeFraction =
			PEAK_ROUTE_FRACTION *
			climbShare(routeProgress(rangeMeters, from.rangeMeters, peak.rangeMeters, blend));
		headingDegrees = lerpAngleDegrees(from.headingDegrees, peak.headingDegrees, blend);
		pitchDegrees = lerp(from.pitchDegrees, peak.pitchDegrees, blend);
		framingX = lerp(from.framingX, peak.framingX, blend);
		framingY = lerp(from.framingY, peak.framingY, blend);
	} else {
		const peakFraction = ascentFraction > 0 ? PEAK_ROUTE_FRACTION : 0;
		routeFraction =
			peakFraction +
			(1 - peakFraction) *
				descentShare(routeProgress(rangeMeters, peak.rangeMeters, to.rangeMeters, blend));
		headingDegrees = lerpAngleDegrees(peak.headingDegrees, to.headingDegrees, blend);
		pitchDegrees = lerp(peak.pitchDegrees, to.pitchDegrees, blend);
		framingX = lerp(peak.framingX, to.framingX, blend);
		framingY = lerp(peak.framingY, to.framingY, blend);
	}

	if (clamp01(fraction) >= 1) {
		return { ...to, routeFraction: 1 };
	}

	if (plan.sweepWeight > 0) {
		routeFraction =
			(1 - plan.sweepWeight) * routeFraction + plan.sweepWeight * sweepFraction(plan, fraction);
	}

	const focus = greatCirclePoint(from, to, routeFraction);
	return {
		latitude: focus.latitude,
		longitude: focus.longitude,
		altitudeMeters: lerp(from.altitudeMeters, to.altitudeMeters, routeFraction),
		headingDegrees,
		pitchDegrees,
		rangeMeters,
		framingX,
		framingY,
		routeFraction
	};
}

export function lookPose(
	look: Pick<
		LookState,
		'headingDegrees' | 'pitchDegrees' | 'rangeMeters' | 'framingX' | 'framingY'
	>,
	verticalFovRadians: number,
	aspect: number
): LookPose | undefined {
	const cameraFromFocus = cameraOffsetFromPose(
		look.headingDegrees,
		look.pitchDegrees,
		look.rangeMeters
	);
	const axes = lookAxesForFraming(
		cameraFromFocus,
		{ x: look.framingX, y: look.framingY },
		verticalFovRadians,
		aspect
	);
	return axes ? { cameraFromFocus, axes } : undefined;
}
