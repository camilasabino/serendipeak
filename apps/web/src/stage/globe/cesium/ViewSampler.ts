import type { Cartesian3, Viewer } from 'cesium';
import { greatCircleDistanceMeters } from '../geodesic';
import { viewHeadingDegrees } from '../orientation';
import { scaleBarFor, scaleSpecForStage, type ScaleReading } from '../scaleBar';
import type { CesiumModule } from './CesiumModule';

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

	groundScale(): ScaleReading | undefined {
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

		return scaleBarFor(greatCircleDistanceMeters(from, to), spec.maxWidthPx, spec.maxWidthPx);
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
