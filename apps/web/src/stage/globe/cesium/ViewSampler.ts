import type { Cartesian3, Viewer } from 'cesium';
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '../../../units/unitSystem';
import { greatCircleDistanceMeters } from '../geodesic';
import { viewHeadingDegrees } from '../orientation';
import { scaleBarFor, scaleSpecForStage, type ScaleReading } from '../scaleBar';
import type { StageSize } from '../stageFrame';
import {
	UNKNOWN_SIGHTING,
	sightBearing,
	sightSummit,
	type CameraSpacePoint,
	type Concealment,
	type Lens,
	type SummitSighting
} from '../summitSighting';
import type { CesiumModule } from './CesiumModule';

/**
 * The sight line to a summit is aimed this far above it. The catalog's elevation and the terrain's
 * never agree to the meter, and a line ending exactly on the summit would catch on the slope
 * under it; terrain that rises above this margin between the camera and the summit does hide it.
 */
export const SIGHT_LINE_LIFT_METERS = 100;

export class ViewSampler {
	private readonly frame: InstanceType<CesiumModule['Matrix4']>;
	private readonly inverse: InstanceType<CesiumModule['Matrix4']>;
	private readonly direction: Cartesian3;
	private readonly up: Cartesian3;
	private readonly ray: InstanceType<CesiumModule['Ray']>;
	private readonly screen: InstanceType<CesiumModule['Cartesian2']>;
	private readonly groundStart: Cartesian3;
	private readonly groundEnd: Cartesian3;
	private readonly cartographic: InstanceType<CesiumModule['Cartographic']>;
	private readonly offset: Cartesian3;
	private readonly lifted: Cartesian3;
	private readonly hit: Cartesian3;
	private occluder: InstanceType<CesiumModule['EllipsoidalOccluder']> | undefined;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer
	) {
		this.frame = new cesium.Matrix4();
		this.inverse = new cesium.Matrix4();
		this.direction = new cesium.Cartesian3();
		this.up = new cesium.Cartesian3();
		this.ray = new cesium.Ray();
		this.screen = new cesium.Cartesian2();
		this.groundStart = new cesium.Cartesian3();
		this.groundEnd = new cesium.Cartesian3();
		this.cartographic = new cesium.Cartographic();
		this.offset = new cesium.Cartesian3();
		this.lifted = new cesium.Cartesian3();
		this.hit = new cesium.Cartesian3();
	}

	viewHeading(): number {
		if (this.viewer.isDestroyed()) {
			return Number.NaN;
		}

		const { Matrix4, Transforms } = this.cesium;
		const { camera } = this.viewer;
		const frame = Transforms.eastNorthUpToFixedFrame(camera.positionWC, undefined, this.frame);
		const inverse = Matrix4.inverse(frame, this.inverse);
		if (!inverse) {
			return Number.NaN;
		}

		const direction = Matrix4.multiplyByPointAsVector(inverse, camera.directionWC, this.direction);
		const up = Matrix4.multiplyByPointAsVector(inverse, camera.upWC, this.up);

		return viewHeadingDegrees(direction.x, direction.y, direction.z, up.x, up.y);
	}

	groundScale(system: UnitSystem = DEFAULT_UNIT_SYSTEM): ScaleReading | undefined {
		if (this.viewer.isDestroyed()) {
			return undefined;
		}

		const { clientWidth: width, clientHeight: height } = this.viewer.scene.canvas;
		const spec = scaleSpecForStage(width);
		if (!(width > spec.insetPx + spec.maxWidthPx) || !(height > spec.bottomPx)) {
			return undefined;
		}

		const row = height - spec.bottomPx - 3;
		const start = this.groundAt(spec.insetPx, row, this.groundStart);
		const end = this.groundAt(spec.insetPx + spec.maxWidthPx, row, this.groundEnd);
		if (!start || !end) {
			return undefined;
		}

		const from = this.geographicOf(start);
		const to = this.geographicOf(end);
		if (!from || !to) {
			return undefined;
		}

		return scaleBarFor(
			greatCircleDistanceMeters(from, to),
			spec.maxWidthPx,
			spec.maxWidthPx,
			system
		);
	}

	/**
	 * Where a point lies relative to the camera, from the camera's own axes and its perspective
	 * frustum, so heading, pitch, roll, position and zoom all count, and a point behind the camera
	 * is told apart instead of mirrored onto the screen.
	 */
	sight(position: Cartesian3): SummitSighting {
		const lens = this.lens();
		if (!lens) {
			return UNKNOWN_SIGHTING;
		}

		const offset = this.cesium.Cartesian3.subtract(
			position,
			this.viewer.camera.positionWC,
			this.offset
		);

		return sightSummit(this.inCameraAxes(offset), lens, this.viewport());
	}

	/**
	 * The summit's horizontal bearing from the camera, as `sightBearing` reads it: the level
	 * direction toward it under the ellipsoid's normal at the camera, which is where the camera's
	 * own heading and pitch are measured from.
	 */
	sightBearing(position: Cartesian3): SummitSighting {
		const lens = this.lens();
		if (!lens) {
			return UNKNOWN_SIGHTING;
		}

		const { camera, scene } = this.viewer;
		const offset = this.cesium.Cartesian3.subtract(position, camera.positionWC, this.offset);
		const up = scene.globe.ellipsoid.geodeticSurfaceNormal(camera.positionWC, this.up);
		if (!up) {
			return UNKNOWN_SIGHTING;
		}

		return sightBearing(this.inCameraAxes(offset), this.inCameraAxes(up), lens, this.viewport());
	}

	/**
	 * What hides a summit from the camera, if anything: the curve of the globe, or terrain on the
	 * sight line to it. Only the terrain the scene has loaded can hide it, so a summit is taken as
	 * seen until the tiles that would hide it arrive.
	 */
	concealment(position: Cartesian3): Concealment | undefined {
		if (this.viewer.isDestroyed()) {
			return undefined;
		}

		const { Cartesian3, EllipsoidalOccluder } = this.cesium;
		const { camera, scene } = this.viewer;
		this.occluder ??= new EllipsoidalOccluder(scene.globe.ellipsoid);
		this.occluder.cameraPosition = camera.positionWC;
		if (!this.occluder.isPointVisible(position)) {
			return 'horizon';
		}

		const up = Cartesian3.normalize(position, this.lifted);
		const target = Cartesian3.add(
			position,
			Cartesian3.multiplyByScalar(up, SIGHT_LINE_LIFT_METERS, this.lifted),
			this.lifted
		);
		const toTarget = Cartesian3.subtract(target, camera.positionWC, this.offset);
		const distance = Cartesian3.magnitude(toTarget);
		if (!(distance > 0)) {
			return undefined;
		}

		this.ray.origin = Cartesian3.clone(camera.positionWC, this.ray.origin);
		this.ray.direction = Cartesian3.divideByScalar(toTarget, distance, this.ray.direction);
		const hit = scene.globe.pick(this.ray, scene, this.hit);

		return hit && Cartesian3.distance(camera.positionWC, hit) < distance ? 'terrain' : undefined;
	}

	viewport(): StageSize {
		if (this.viewer.isDestroyed()) {
			return { width: 0, height: 0 };
		}
		const { clientWidth: width, clientHeight: height } = this.viewer.scene.canvas;

		return { width, height };
	}

	projectFraming(summit: Cartesian3): { x: number; y: number } | undefined {
		const { Cartesian3, SceneTransforms } = this.cesium;
		const { camera, scene } = this.viewer;

		const toSummit = Cartesian3.subtract(summit, camera.positionWC, new Cartesian3());
		if (Cartesian3.dot(camera.directionWC, toSummit) <= 1e-8) {
			return undefined;
		}

		const windowPosition = SceneTransforms.worldToWindowCoordinates(scene, summit);
		if (!windowPosition) {
			return undefined;
		}

		const width = scene.canvas.clientWidth;
		const height = scene.canvas.clientHeight;
		if (!(width > 0) || !(height > 0)) {
			return undefined;
		}

		const x = (windowPosition.x - width / 2) / (width / 2);
		const y = (height / 2 - windowPosition.y) / (height / 2);

		return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : undefined;
	}

	private lens(): Lens | undefined {
		if (this.viewer.isDestroyed()) {
			return undefined;
		}
		const frustum = this.viewer.camera.frustum;
		if (!(frustum instanceof this.cesium.PerspectiveFrustum) || frustum.fovy === undefined) {
			return undefined;
		}
		const tanHalfHeight = Math.tan(frustum.fovy / 2);

		return { tanHalfWidth: tanHalfHeight * (frustum.aspectRatio ?? Number.NaN), tanHalfHeight };
	}

	private inCameraAxes(vector: Cartesian3): CameraSpacePoint {
		const { Cartesian3 } = this.cesium;
		const { camera } = this.viewer;

		return {
			right: Cartesian3.dot(vector, camera.rightWC),
			up: Cartesian3.dot(vector, camera.upWC),
			forward: Cartesian3.dot(vector, camera.directionWC)
		};
	}

	private groundAt(x: number, y: number, result: Cartesian3): Cartesian3 | undefined {
		const { camera, scene } = this.viewer;
		const ray = camera.getPickRay(this.cesium.Cartesian2.fromElements(x, y, this.screen), this.ray);

		return ray ? scene.globe.pick(ray, scene, result) : undefined;
	}

	private geographicOf(position: Cartesian3) {
		const cartographic = this.cesium.Cartographic.fromCartesian(
			position,
			undefined,
			this.cartographic
		);
		if (!cartographic) {
			return undefined;
		}

		return {
			latitude: (cartographic.latitude * 180) / Math.PI,
			longitude: (cartographic.longitude * 180) / Math.PI
		};
	}
}
