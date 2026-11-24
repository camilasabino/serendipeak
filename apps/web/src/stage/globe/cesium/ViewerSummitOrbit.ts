import type { Cartesian3, Viewer } from 'cesium';
import {
	LIFT_LOOKAHEAD_SAMPLES,
	LIFT_LOOKAHEAD_SECONDS,
	NO_LIFT,
	ORBIT_CLEARANCE_METERS,
	advanceOrbitAngle,
	easeLift,
	liftForClimb,
	maxLiftCorrection,
	orbitClearanceFloorMeters,
	type OrbitLift
} from '../mountainOrbit';
import type { CesiumModule } from './CesiumModule';

// Beyond these the camera was moved by someone else since the last turn, and it is theirs now.
const EXTERNAL_MOVE_METERS = 1;
const EXTERNAL_TURN = 1e-4;
// A camera this close to straight above the summit has no tilt to raise; it only turns.
const MIN_LIFT_AXIS = 1e-6;
// A correction aims this far above the floor, so rounding never leaves it a hair below.
const CORRECTION_MARGIN_METERS = 0.25;

export interface OrbitSummit {
	latitude: number;
	longitude: number;
	elevationMeters: number;
}

interface SummitOrbitRun {
	periodSeconds: number;
	onHalted: () => void;
	removeFrame: () => void;
	lastFrameAt: number | undefined;
	angle: number;
	lift: OrbitLift;
	pivot: Cartesian3;
	/** The vertical through the summit, which the orbit turns about. */
	axis: Cartesian3;
	/** Horizontal through the summit, square to the starting line of sight; undefined from above. */
	liftAxis: Cartesian3 | undefined;
	startElevation: number;
	rangeMeters: number;
	offset: Cartesian3;
	direction: Cartesian3;
	up: Cartesian3;
	clearanceFloorMeters: number;
	applied: Cartesian3;
	appliedDirection: Cartesian3;
}

/**
 * Circles the camera around a summit: each frame turns the pose it started from about the vertical
 * through the summit, so range, tilt and where the summit sits on screen hold while its faces pass.
 * Where the ground ahead rises toward the camera, it raises the camera around the summit instead,
 * which keeps range and framing and only tilts the view down, and settles back once past. Every
 * frame is computed from the starting pose, the angle turned and that lift, never from the
 * previous frame, so nothing drifts however many times it goes round. It never fights anyone else
 * for the camera; the first move it did not make ends it, as does ground it could not clear.
 */
export class ViewerSummitOrbit {
	private run: SummitOrbitRun | undefined;
	private readonly rotation: InstanceType<CesiumModule['Matrix3']>;
	private readonly turn: InstanceType<CesiumModule['Quaternion']>;
	private readonly raise: InstanceType<CesiumModule['Quaternion']>;
	private readonly scratchPosition: Cartesian3;
	private readonly scratchDirection: Cartesian3;
	private readonly scratchUp: Cartesian3;
	private readonly scratchGround: InstanceType<CesiumModule['Cartographic']>;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer,
		private readonly allowed: () => boolean
	) {
		this.rotation = new cesium.Matrix3();
		this.turn = new cesium.Quaternion();
		this.raise = new cesium.Quaternion();
		this.scratchPosition = new cesium.Cartesian3();
		this.scratchDirection = new cesium.Cartesian3();
		this.scratchUp = new cesium.Cartesian3();
		this.scratchGround = new cesium.Cartographic();
	}

	get running(): boolean {
		return this.run !== undefined;
	}

	start(summit: OrbitSummit, periodSeconds: number, onHalted: () => void): boolean {
		this.stop();
		if (this.viewer.isDestroyed() || !(periodSeconds > 0) || !this.allowed()) {
			return false;
		}

		const { Cartesian3 } = this.cesium;
		const { camera, scene } = this.viewer;
		const pivot = Cartesian3.fromDegrees(summit.longitude, summit.latitude, summit.elevationMeters);
		const offset = Cartesian3.subtract(camera.positionWC, pivot, new Cartesian3());
		const rangeMeters = Cartesian3.magnitude(offset);
		const axis = scene.ellipsoid.geodeticSurfaceNormal(pivot, new Cartesian3());
		if (!axis || !(rangeMeters > 0)) {
			return false;
		}

		const across = Cartesian3.cross(offset, axis, new Cartesian3());
		const run: SummitOrbitRun = {
			periodSeconds,
			onHalted,
			removeFrame: () => {},
			lastFrameAt: undefined,
			angle: 0,
			lift: NO_LIFT,
			pivot,
			axis,
			liftAxis:
				Cartesian3.magnitude(across) > MIN_LIFT_AXIS * rangeMeters
					? Cartesian3.normalize(across, across)
					: undefined,
			startElevation: Math.asin(
				Math.min(1, Math.max(-1, Cartesian3.dot(offset, axis) / rangeMeters))
			),
			rangeMeters,
			offset,
			direction: Cartesian3.clone(camera.directionWC),
			up: Cartesian3.clone(camera.upWC),
			clearanceFloorMeters: orbitClearanceFloorMeters(this.clearanceAt(camera.positionWC)),
			applied: Cartesian3.clone(camera.positionWC),
			appliedDirection: Cartesian3.clone(camera.directionWC)
		};
		this.run = run;
		run.removeFrame = scene.preUpdate.addEventListener(() => this.advance(run));

		return true;
	}

	stop(): void {
		const run = this.run;
		this.run = undefined;
		run?.removeFrame();
	}

	private halt(run: SummitOrbitRun): void {
		if (this.run !== run) {
			return;
		}
		this.stop();
		run.onHalted();
	}

	private advance(run: SummitOrbitRun): void {
		if (this.run !== run) {
			return;
		}
		const { Cartesian3, Matrix3, Matrix4 } = this.cesium;
		const { camera } = this.viewer;

		const moved = !Cartesian3.equalsEpsilon(
			camera.positionWC,
			run.applied,
			0,
			EXTERNAL_MOVE_METERS
		);
		const turned = !Cartesian3.equalsEpsilon(
			camera.directionWC,
			run.appliedDirection,
			EXTERNAL_TURN,
			0
		);
		if (moved || turned || !this.allowed()) {
			this.halt(run);
			return;
		}

		const now = performance.now();
		const last = run.lastFrameAt;
		run.lastFrameAt = document.visibilityState === 'hidden' ? undefined : now;
		if (last === undefined || run.lastFrameAt === undefined) {
			return;
		}

		const elapsed = (now - last) / 1000;
		const angle = advanceOrbitAngle(run.angle, elapsed, run.periodSeconds);
		const lift = this.clearedLift(
			run,
			angle,
			easeLift(run.lift, this.liftAhead(run, angle), elapsed),
			maxLiftCorrection(elapsed)
		);
		if (!lift) {
			this.halt(run);
			return;
		}

		Matrix3.multiplyByVector(this.rotation, run.direction, this.scratchDirection);
		Matrix3.multiplyByVector(this.rotation, run.up, this.scratchUp);
		camera.setView({
			destination: this.scratchPosition,
			orientation: { direction: this.scratchDirection, up: this.scratchUp },
			endTransform: Matrix4.IDENTITY
		});
		run.angle = angle;
		run.lift = lift;
		Cartesian3.clone(camera.positionWC, run.applied);
		Cartesian3.clone(camera.directionWC, run.appliedDirection);
	}

	// Places the pose for this angle and lift, raised by as much as `allowance` where it would still
	// come nearer the ground than the floor; undefined where that is not enough.
	private clearedLift(
		run: SummitOrbitRun,
		angle: number,
		eased: OrbitLift,
		allowance: number
	): OrbitLift | undefined {
		let lift = eased;
		for (let attempt = 0; attempt < 2; attempt += 1) {
			this.pose(run, angle, lift.radians);
			const clearance = this.clearanceAt(this.scratchPosition);
			if (clearance === undefined || clearance >= run.clearanceFloorMeters) {
				return lift;
			}
			const raised = liftForClimb(
				run.startElevation,
				lift.radians,
				run.rangeMeters,
				run.clearanceFloorMeters - clearance + CORRECTION_MARGIN_METERS
			);
			if (!run.liftAxis || raised <= lift.radians || raised - eased.radians > allowance) {
				return undefined;
			}
			lift = { radians: raised, rate: Math.max(lift.rate, 0) };
		}
		this.pose(run, angle, lift.radians);
		const clearance = this.clearanceAt(this.scratchPosition);

		return clearance === undefined || clearance >= run.clearanceFloorMeters ? lift : undefined;
	}

	// The highest lift the ground along the next stretch of the path asks for, read at the lift in
	// force now. Ground not yet loaded asks for nothing.
	private liftAhead(run: SummitOrbitRun, angle: number): number {
		if (!run.liftAxis) {
			return 0;
		}
		const sweep = (2 * Math.PI * LIFT_LOOKAHEAD_SECONDS) / run.periodSeconds;
		let wanted = 0;
		for (let sample = 0; sample <= LIFT_LOOKAHEAD_SAMPLES; sample += 1) {
			this.pose(run, angle + (sweep * sample) / LIFT_LOOKAHEAD_SAMPLES, run.lift.radians);
			const clearance = this.clearanceAt(this.scratchPosition);
			if (clearance === undefined) {
				continue;
			}
			const climb = ORBIT_CLEARANCE_METERS - clearance;
			wanted = Math.max(
				wanted,
				liftForClimb(run.startElevation, run.lift.radians, run.rangeMeters, climb)
			);
		}

		return wanted;
	}

	// Leaves the rotation for this angle and lift in `rotation` and the camera position in
	// `scratchPosition`. The lift raises the starting pose around the summit first, then the turn
	// carries it round, so both rotations pass through the summit and keep it where it was on screen.
	private pose(run: SummitOrbitRun, angle: number, lift: number): void {
		const { Cartesian3, Matrix3, Quaternion } = this.cesium;
		// Negative about the local up: the camera circles clockwise seen from above, so the heading,
		// and the compass with it, turns steadily one way.
		Quaternion.fromAxisAngle(run.axis, -angle, this.turn);
		if (run.liftAxis && lift > 0) {
			Quaternion.fromAxisAngle(run.liftAxis, lift, this.raise);
			Quaternion.multiply(this.turn, this.raise, this.turn);
		}
		Matrix3.fromQuaternion(this.turn, this.rotation);
		Matrix3.multiplyByVector(this.rotation, run.offset, this.scratchPosition);
		Cartesian3.add(run.pivot, this.scratchPosition, this.scratchPosition);
	}

	// Unknown where the terrain under that point has not loaded; the frame then goes ahead rather
	// than halting the orbit on a guess.
	private clearanceAt(position: Cartesian3): number | undefined {
		const { scene } = this.viewer;
		const ground = this.cesium.Cartographic.fromCartesian(
			position,
			scene.ellipsoid,
			this.scratchGround
		);
		if (!ground) {
			return undefined;
		}
		const terrain = scene.globe.getHeight(ground);

		return terrain === undefined ? undefined : ground.height - terrain;
	}
}
