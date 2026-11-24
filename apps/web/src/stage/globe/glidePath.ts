import {
	cameraOffsetFromPose,
	lookAxesForFraming,
	type LookAxes,
	type SummitOffset
} from './framing';
import { EARTH_MEAN_RADIUS_METERS, greatCircleDistanceMeters, greatCirclePoint } from './geodesic';

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
	pitchDegrees: number;
}

/**
 * How the perceived motion of a glide speeds up and settles: its speed over normalized time
 * follows `t^rise * (1 - t)^settle`. A larger `settle` than `rise` leaves a longer, gentler
 * arrival than departure.
 */
export interface GlideEase {
	rise: number;
	settle: number;
}

/** The path of a glide, before it is timed. Without a peak the camera never climbs. */
export interface GlideShape {
	journey: TransitionJourney;
	transitionClass: TransitionClass | undefined;
	distanceMeters: number;
	from: LookState;
	to: LookState;
	peak: GlidePeak | undefined;
	ease: GlideEase;
}

/**
 * Precomputed tables, each at uniform steps from 0 to 1. `route` is the share of the ground track
 * covered at each step of the path parameter `s`; `timing` is the `s` reached, and `turn` the
 * share of the heading change made, at each step of normalized time. `perceivedLength` is how
 * much the view changes along the whole glide.
 */
export interface GlideProfile {
	route: readonly number[];
	turn: readonly number[];
	timing: readonly number[];
	perceivedLength: number;
}

export interface TimedGlide extends GlideShape {
	profile: GlideProfile;
	durationSeconds: number;
}

/**
 * How a glide spends its time. The base pace spreads the perceived length over
 * `baseSeconds(perceivedLength)` with the shape's ease. On the way down, every unit of perceived
 * length the camera covers near the destination's scale costs `arrival.secondsPerLength` more:
 * fully within `arrival.rangeMeters`, easing in from `arrival.rampFactor` times that range.
 * Wherever the slide would still outpace `sweep.maxSlidePerSecond`, that stretch takes longer.
 */
export interface GlidePace {
	baseSeconds: (perceivedLength: number) => number;
	arrival: {
		rangeMeters: number;
		rampFactor: number;
		secondsPerLength: number;
	};
	sweep: {
		maxSlidePerSecond: number;
	};
}

export interface GlidePlan extends TimedGlide {
	phases: readonly [GlidePhase, GlidePhase];
}

export interface GlideFrame extends LookState {
	routeFraction: number;
}

export interface LookPose {
	cameraFromFocus: SummitOffset;
	axes: LookAxes;
}

const PROFILE_STEPS = 256;
// Where the climb ends on the path parameter. Timing is re-derived from the perceived length,
// so this only decides how the ground track is shared out around the top of the arc.
const PEAK_SHAPE_FRACTION = 0.5;
// How much the picture changes, relative to the field of view changing by a factor of e, when the
// focus slides by one camera range, and when the heading or pitch turns by one radian. Sliding
// weighs more than zooming: a slide replaces what is on screen, while a zoom keeps the centre.
const SLIDE_WEIGHT = 1.6;
const ROTATION_WEIGHT = 0.7;
// A framing offset of 1 moves the summit half the stage across.
const FRAMING_WEIGHT = 0.5;
// The share of the path parameter over which the arrival slowdown phases in after the apex, so
// a glide whose apex is already near the destination's scale does not brake at once.
const ARRIVAL_ONSET = 0.15;
// For a glide that climbs, the least change a step of the path parameter is timed as near the apex,
// as a share of the average step, added in quadrature. At the apex the zoom and the tilt reverse;
// timed by their size alone, the camera would rush through it and flip them within a frame or two
// instead of easing them to rest. The floor fades out over `REVERSAL_SPAN` of the path parameter on
// either side, so the rest of the glide keeps its pace.
const REVERSAL_FLOOR = 1;
const REVERSAL_SPAN = 0.15;
// How sharply the sweep limit takes hold: well below the limit a stretch keeps its pace, well above
// it the slide runs at the limit, and in between the pace bends without a corner.
const SWEEP_LIMIT_SHARPNESS = 4;
const LENGTH_EPSILON = 1e-9;

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

function toRadians(degrees: number): number {
	return (degrees * Math.PI) / 180;
}

function angleDeltaDegrees(start: number, end: number): number {
	return ((((end - start + 180) % 360) + 360) % 360) - 180;
}

export function lerpAngleDegrees(start: number, end: number, t: number): number {
	return start + angleDeltaDegrees(start, end) * t;
}

function tableAt(table: readonly number[], fraction: number): number {
	const position = clamp01(fraction) * (table.length - 1);
	const index = Math.min(table.length - 2, Math.floor(position));
	return lerp(table[index]!, table[index + 1]!, position - index);
}

interface ShapeSample {
	rangeMeters: number;
	pitchDegrees: number;
	framingX: number;
	framingY: number;
}

// Range moves on a logarithmic scale, so every doubling of altitude takes the same share of the
// path; pitch and framing follow it, steepening as the camera climbs and easing back as it lands.
function sampleShape({ from, to, peak }: GlideShape, s: number): ShapeSample {
	if (peak && s < PEAK_SHAPE_FRACTION) {
		const blend = smoothstep(s / PEAK_SHAPE_FRACTION);
		return {
			rangeMeters: Math.exp(lerp(Math.log(from.rangeMeters), Math.log(peak.rangeMeters), blend)),
			pitchDegrees: lerp(from.pitchDegrees, peak.pitchDegrees, blend),
			framingX: lerp(from.framingX, 0, blend),
			framingY: lerp(from.framingY, 0, blend)
		};
	}
	const start = peak
		? { rangeMeters: peak.rangeMeters, pitchDegrees: peak.pitchDegrees, framingX: 0, framingY: 0 }
		: from;
	const blend = peak
		? smoothstep((s - PEAK_SHAPE_FRACTION) / (1 - PEAK_SHAPE_FRACTION))
		: smoothstep(s);
	return {
		rangeMeters: Math.exp(lerp(Math.log(start.rangeMeters), Math.log(to.rangeMeters), blend)),
		pitchDegrees: lerp(start.pitchDegrees, to.pitchDegrees, blend),
		framingX: lerp(start.framingX, to.framingX, blend),
		framingY: lerp(start.framingY, to.framingY, blend)
	};
}

function frameAt(
	shape: GlideShape,
	s: number,
	routeFraction: number,
	turnFraction: number
): GlideFrame {
	const { from, to } = shape;
	const sample = sampleShape(shape, s);
	const focus = greatCirclePoint(from, to, routeFraction);
	return {
		latitude: focus.latitude,
		longitude: focus.longitude,
		altitudeMeters: lerp(from.altitudeMeters, to.altitudeMeters, routeFraction),
		headingDegrees: lerpAngleDegrees(from.headingDegrees, to.headingDegrees, turnFraction),
		...sample,
		routeFraction
	};
}

// The `t * (1 - t)` window starts and ends what it shares out at rest.
function cumulativeShare(weight: (t: number) => number): number[] {
	const weights = Array.from({ length: PROFILE_STEPS + 1 }, (_, index) => {
		const t = index / PROFILE_STEPS;
		return weight(t) * t * (1 - t);
	});
	const cumulative = [0];
	for (let index = 1; index <= PROFILE_STEPS; index += 1) {
		cumulative.push(cumulative[index - 1]! + (weights[index - 1]! + weights[index]!) / 2);
	}
	const total = cumulative[PROFILE_STEPS]!;
	return cumulative.map((value) => value / total);
}

// Ground speed follows the camera range, so the track moves at a steady pace on screen and is
// covered mostly from high up.
function routeTable(shape: GlideShape): number[] {
	return cumulativeShare((s) => sampleShape(shape, s).rangeMeters);
}

// The heading turns once, the short way: an intermediate bearing would add a turn out and a turn
// back. It is shared out over time rather than over the path, which spends little time at the
// apex, and weighted by the logarithm of the range, so the turn happens mostly while the camera
// is high, where it reads as the map rotating, rather than near a summit, where it reads as a pan.
function turnTable(shape: GlideShape, timing: readonly number[]): number[] {
	const lowest = Math.min(shape.from.rangeMeters, shape.to.rangeMeters);
	return cumulativeShare(
		(t) => 1 + Math.log(sampleShape(shape, tableAt(timing, t)).rangeMeters / lowest)
	);
}

interface PerceivedStep {
	length: number;
	slide: number;
}

function perceivedStep(a: GlideFrame, b: GlideFrame): PerceivedStep {
	const zoom = Math.log(b.rangeMeters / a.rangeMeters);
	// Once the camera is farther out than the Earth is wide, a slide turns the whole globe, and the
	// angle it turns through, not the camera range, is what the eye follows.
	const scale = Math.min(Math.sqrt(a.rangeMeters * b.rangeMeters), EARTH_MEAN_RADIUS_METERS);
	const slide = (SLIDE_WEIGHT * greatCircleDistanceMeters(a, b)) / scale;
	const tilt = ROTATION_WEIGHT * toRadians(b.pitchDegrees - a.pitchDegrees);
	const reframe = FRAMING_WEIGHT * Math.hypot(b.framingX - a.framingX, b.framingY - a.framingY);
	return { length: Math.hypot(zoom, slide, tilt, reframe), slide };
}

function apexWeight(s: number): number {
	return 1 - smoothstep(Math.abs(s - PEAK_SHAPE_FRACTION) / REVERSAL_SPAN);
}

// Stretches the time of a step whose slide would outpace the sweep limit, by a smooth maximum of
// its paced time and the time the limit allows the slide.
function sweptSeconds(
	stepSeconds: number,
	slide: number,
	{ maxSlidePerSecond }: GlidePace['sweep']
): number {
	if (!(stepSeconds > 0)) {
		return stepSeconds;
	}
	const overspeed = slide / (stepSeconds * maxSlidePerSecond);
	return (
		stepSeconds *
		Math.pow(1 + Math.pow(overspeed, SWEEP_LIMIT_SHARPNESS), 1 / SWEEP_LIMIT_SHARPNESS)
	);
}

function easedProgress({ rise, settle }: GlideEase): number[] {
	const speeds = Array.from({ length: PROFILE_STEPS }, (_, index) => {
		const t = (index + 0.5) / PROFILE_STEPS;
		return Math.pow(t, rise) * Math.pow(1 - t, settle);
	});
	const total = speeds.reduce((sum, speed) => sum + speed, 0);
	const progress = [0];
	for (const speed of speeds) {
		progress.push(progress.at(-1)! + speed / total);
	}
	progress[PROFILE_STEPS] = 1;
	return progress;
}

function inverseOf(cumulative: readonly number[], value: number): number {
	let low = 0;
	let high = cumulative.length - 1;
	while (high - low > 1) {
		const middle = (low + high) >> 1;
		if (cumulative[middle]! < value) {
			low = middle;
		} else {
			high = middle;
		}
	}
	const span = cumulative[high]! - cumulative[low]!;
	const within = span > 0 ? clamp01((value - cumulative[low]!) / span) : 0;
	return (low + within) / (cumulative.length - 1);
}

// How fully a stretch of the path counts as arriving: only once the camera is on its way down,
// and more the closer its range is to the destination's scale. Both ramps are smooth, so the
// slowdown changes the speed without a jolt.
function arrivalWeight(
	shape: GlideShape,
	s: number,
	rangeMeters: number,
	{ rangeMeters: arrivalRange, rampFactor }: GlidePace['arrival']
): number {
	const descending = shape.peak ? smoothstep((s - PEAK_SHAPE_FRACTION) / ARRIVAL_ONSET) : 1;
	const near = smoothstep(
		Math.log((arrivalRange * rampFactor) / rangeMeters) / Math.log(rampFactor)
	);
	return descending * near;
}

/**
 * Times a glide by how much the view changes rather than by the path parameter: the camera moves
 * at a perceived pace that only rises and settles with the ease, so no stretch of the path, such
 * as the top of the arc where the climb gives way to the descent, stalls or rushes.
 *
 * The arrival time is added to, not shared with, the base pace: the departure keeps its timing,
 * while the descent starts slowing high above the destination and crosses the last scales, where
 * relief and detail fill the view, at a pace the eye can follow. A uniform ease alone settles only
 * at the very end, after rushing those scales.
 *
 * The sweep limit then slows only the stretches where the slide runs too fast. A zoom keeps the
 * centre of the view in place, while a slide sweeps everything across it and, from high up, turns
 * the whole globe: at the pace that suits a zoom it reads as a whip pan or a spin.
 */
export function timeGlide(shape: GlideShape, pace: GlidePace): TimedGlide {
	const route = routeTable(shape);
	const frames = Array.from({ length: PROFILE_STEPS + 1 }, (_, index) =>
		frameAt(shape, index / PROFILE_STEPS, route[index]!, 0)
	);
	const steps = frames.slice(1).map((frame, index) => perceivedStep(frames[index]!, frame));
	const viewChange = steps.reduce((sum, step) => sum + step.length, 0);
	const floor = shape.peak ? (REVERSAL_FLOOR * viewChange) / PROFILE_STEPS : 0;

	const lengths = [0];
	const extraSeconds = [0];
	steps.forEach((step, index) => {
		const previous = frames[index]!;
		const frame = frames[index + 1]!;
		const length = Math.hypot(step.length, floor * apexWeight((index + 0.5) / PROFILE_STEPS));
		const arrival = arrivalWeight(
			shape,
			(index + 0.5) / PROFILE_STEPS,
			Math.sqrt(previous.rangeMeters * frame.rangeMeters),
			pace.arrival
		);
		lengths.push(lengths[index]! + length);
		extraSeconds.push(extraSeconds[index]! + pace.arrival.secondsPerLength * arrival * step.length);
	});
	const pathLength = lengths[PROFILE_STEPS]!;
	const turnRadians = Math.abs(
		toRadians(angleDeltaDegrees(shape.from.headingDegrees, shape.to.headingDegrees))
	);
	const perceivedLength = viewChange + ROTATION_WEIGHT * turnRadians;
	const baseSeconds = pace.baseSeconds(perceivedLength);
	const progress = easedProgress(shape.ease);
	if (!(viewChange > LENGTH_EPSILON)) {
		return {
			...shape,
			profile: { route, turn: turnTable(shape, progress), timing: progress, perceivedLength },
			durationSeconds: baseSeconds
		};
	}
	// The seconds at which the camera reaches each step of the path parameter.
	const paced = lengths.map(
		(length, index) => baseSeconds * inverseOf(progress, length / pathLength) + extraSeconds[index]!
	);
	const seconds = [0];
	steps.forEach((step, index) => {
		const stepSeconds = paced[index + 1]! - paced[index]!;
		seconds.push(seconds[index]! + sweptSeconds(stepSeconds, step.slide, pace.sweep));
	});
	const durationSeconds = seconds[PROFILE_STEPS]!;
	const timing = seconds.map((_, index) =>
		inverseOf(seconds, (index / PROFILE_STEPS) * durationSeconds)
	);
	return {
		...shape,
		profile: { route, turn: turnTable(shape, timing), timing, perceivedLength },
		durationSeconds
	};
}

export function sampleGlide(plan: GlidePlan, fraction: number): GlideFrame {
	if (clamp01(fraction) >= 1) {
		return { ...plan.to, routeFraction: 1 };
	}
	const { timing, route, turn } = plan.profile;
	const s = tableAt(timing, fraction);
	return frameAt(plan, s, tableAt(route, s), tableAt(turn, fraction));
}

export function glideRangeAt(plan: TimedGlide, fraction: number): number {
	if (clamp01(fraction) >= 1) {
		return plan.to.rangeMeters;
	}
	return sampleShape(plan, tableAt(plan.profile.timing, fraction)).rangeMeters;
}

/** The time fraction at which the camera tops its climb, or 0 for a glide that only descends. */
export function glidePeakFraction(plan: TimedGlide): number {
	return plan.peak ? inverseOf(plan.profile.timing, PEAK_SHAPE_FRACTION) : 0;
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
