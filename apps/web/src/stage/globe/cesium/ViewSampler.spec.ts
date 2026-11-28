import * as cesium from 'cesium';
import type { Viewer } from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import type { CesiumModule } from './CesiumModule';
import { ViewSampler } from './ViewSampler';

const { Cartesian3, Cartesian4, Matrix4, PerspectiveFrustum } = cesium;

const STAGE = { width: 960, height: 600 };

/** A camera above Aconcagua looking north and down, as a settled mountain view might stand. */
function cameraAt(
	headingDegrees: number,
	pitchDegrees: number,
	frustum: cesium.PerspectiveFrustum | cesium.OrthographicFrustum
) {
	const position = Cartesian3.fromDegrees(-70.011, -32.75, 9_000);
	const enu = cesium.Transforms.eastNorthUpToFixedFrame(position);
	const h = cesium.Math.toRadians(headingDegrees);
	const p = cesium.Math.toRadians(pitchDegrees);
	const local = (x: number, y: number, z: number) =>
		Cartesian3.normalize(
			Matrix4.multiplyByPointAsVector(enu, new Cartesian3(x, y, z), new Cartesian3()),
			new Cartesian3()
		);
	const direction = local(Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p));
	const right = local(Math.cos(h), -Math.sin(h), 0);
	const up = Cartesian3.cross(right, direction, new Cartesian3());

	return { positionWC: position, directionWC: direction, upWC: up, rightWC: right, frustum };
}

function samplerFor(camera: ReturnType<typeof cameraAt>, destroyed = false) {
	const viewer = {
		isDestroyed: () => destroyed,
		camera,
		scene: { canvas: { clientWidth: STAGE.width, clientHeight: STAGE.height } }
	};

	return new ViewSampler(cesium as unknown as CesiumModule, viewer as unknown as Viewer);
}

function perspective(): cesium.PerspectiveFrustum {
	return new PerspectiveFrustum({
		fov: cesium.Math.toRadians(60),
		aspectRatio: STAGE.width / STAGE.height,
		near: 1,
		far: 1e9
	});
}

/** Cesium's own projection: view matrix, projection matrix, perspective divide, viewport. */
function cesiumWindowPosition(camera: ReturnType<typeof cameraAt>, point: cesium.Cartesian3) {
	const view = Matrix4.computeView(
		camera.positionWC,
		camera.directionWC,
		camera.upWC,
		camera.rightWC,
		new Matrix4()
	);
	const clip = Matrix4.multiplyByVector(
		camera.frustum.projectionMatrix,
		Matrix4.multiplyByVector(
			view,
			Cartesian4.fromElements(point.x, point.y, point.z, 1),
			new Cartesian4()
		),
		new Cartesian4()
	);

	return {
		x: ((clip.x / clip.w + 1) / 2) * STAGE.width,
		y: ((1 - clip.y / clip.w) / 2) * STAGE.height
	};
}

describe('ViewSampler.sight', () => {
	it.each([
		['the presented summit', -70.011, -32.653, 6961],
		['a summit ahead and to the right', -69.3, -32.55, 5200],
		['a summit 600 km ahead', -68.541, -27.109, 6893]
	])('projects %s exactly where Cesium does', (_name, longitude, latitude, height) => {
		const camera = cameraAt(10, -25, perspective());
		const point = Cartesian3.fromDegrees(longitude, latitude, height);

		const sighting = samplerFor(camera).sight(point);
		const expected = cesiumWindowPosition(camera, point);

		expect(sighting).toEqual({
			kind: 'ahead',
			x: expect.closeTo(expected.x, 6),
			y: expect.closeTo(expected.y, 6)
		});
	});

	it('tells a summit behind the camera apart instead of projecting it', () => {
		const camera = cameraAt(180, -25, perspective());

		const sighting = samplerFor(camera).sight(Cartesian3.fromDegrees(-68.541, -27.109, 6893));

		expect(sighting.kind).toBe('behind');
	});

	it('gives no direction without a perspective frustum, or once the viewer is gone', () => {
		const point = Cartesian3.fromDegrees(-69.455, -33.016, 5968);
		const orthographic = cameraAt(
			0,
			-25,
			new cesium.OrthographicFrustum({ width: 1000, aspectRatio: 1.6 })
		);

		expect(samplerFor(orthographic).sight(point)).toEqual({ kind: 'unknown' });
		expect(samplerFor(cameraAt(0, -25, perspective()), true).sight(point)).toEqual({
			kind: 'unknown'
		});
	});

	it('reads the canvas size the sightings were projected onto', () => {
		expect(samplerFor(cameraAt(0, -25, perspective())).viewport()).toEqual(STAGE);
	});
});

describe('ViewSampler.concealment', () => {
	// The camera stands 9 km above Aconcagua's slopes; the summit is the presented one, 6,961 m.
	const summit = () => Cartesian3.fromDegrees(-70.011, -32.653, 6961);
	const camera = () => cameraAt(10, -25, perspective());

	function sampler(pick: (ray: cesium.Ray) => cesium.Cartesian3 | undefined) {
		const viewer = {
			isDestroyed: () => false,
			camera: camera(),
			scene: {
				canvas: { clientWidth: STAGE.width, clientHeight: STAGE.height },
				globe: { ellipsoid: cesium.Ellipsoid.WGS84, pick: (ray: cesium.Ray) => pick(ray) }
			}
		};

		return {
			sampler: new ViewSampler(cesium as unknown as CesiumModule, viewer as unknown as Viewer),
			viewer
		};
	}

	it('finds a summit in plain view unconcealed when no terrain stands on the sight line', () => {
		expect(sampler(() => undefined).sampler.concealment(summit())).toBeUndefined();
	});

	it('aims the sight line from the camera at a point a little above the summit', () => {
		let aimed: cesium.Ray | undefined;
		const { sampler: sight, viewer } = sampler((ray) => {
			aimed = new cesium.Ray(ray.origin.clone(), ray.direction.clone());
			return undefined;
		});

		sight.concealment(summit());

		expect(aimed!.origin).toEqual(viewer.camera.positionWC);
		const toSummit = Cartesian3.subtract(summit(), viewer.camera.positionWC, new Cartesian3());
		const distance = Cartesian3.magnitude(toSummit);
		const aimPoint = Cartesian3.add(
			viewer.camera.positionWC,
			Cartesian3.multiplyByScalar(aimed!.direction, distance, new Cartesian3()),
			new Cartesian3()
		);
		const lift = Cartesian3.distance(aimPoint, summit());
		expect(lift).toBeGreaterThan(50);
		expect(lift).toBeLessThan(250);
	});

	it('calls a summit concealed by terrain when the ground is met well before it', () => {
		const midway = Cartesian3.lerp(camera().positionWC, summit(), 0.5, new Cartesian3());

		expect(sampler(() => midway).sampler.concealment(summit())).toBe('terrain');
	});

	it('does not call it concealed when the ground met is the summit’s own slope', () => {
		const onSlope = Cartesian3.fromDegrees(-70.011, -32.653, 6955);

		expect(sampler(() => onSlope).sampler.concealment(summit())).toBeUndefined();
	});

	it('calls a summit beyond the curve of the globe concealed by the horizon, before looking at terrain', () => {
		const pick = vi.fn(() => undefined);
		const far = Cartesian3.fromDegrees(-70.011, -32.653 + 900 / 111.2, 6000);
		const { sampler: sight } = sampler(pick);

		const beyond = sight.concealment(far);

		expect(beyond).toBe('horizon');
		expect(pick).not.toHaveBeenCalled();
	});

	it('says nothing once the viewer is gone', () => {
		const viewer = {
			isDestroyed: () => true,
			camera: camera(),
			scene: { canvas: { clientWidth: 1, clientHeight: 1 }, globe: {} }
		};

		expect(
			new ViewSampler(cesium as unknown as CesiumModule, viewer as unknown as Viewer).concealment(
				summit()
			)
		).toBeUndefined();
	});
});

describe('ViewSampler on Aneto’s canonical view, with Mont Blanc, the Matterhorn and the Eiger', () => {
	const WIDE = { width: 1440, height: 900 };
	const ANETO = { latitude: 42.6311462, longitude: 0.6566507, elevation: 3404 };
	const NEIGHBOURS = {
		'mont-blanc': Cartesian3.fromDegrees(6.8651706, 45.8327056, 4807),
		matterhorn: Cartesian3.fromDegrees(7.6586024, 45.9764263, 4478),
		eiger: Cartesian3.fromDegrees(8.0054694, 46.5776321, 3970)
	};
	type Slug = keyof typeof NEIGHBOURS;

	/** The catalog's pose: heading 38.32°, pitch −5.95°, the camera `range` back from the summit. */
	function viewFrom(range: number) {
		const summit = Cartesian3.fromDegrees(ANETO.longitude, ANETO.latitude, ANETO.elevation);
		const enu = cesium.Transforms.eastNorthUpToFixedFrame(summit);
		const h = cesium.Math.toRadians(38.32);
		const p = cesium.Math.toRadians(-5.95);
		const local = (x: number, y: number, z: number) =>
			Cartesian3.normalize(
				Matrix4.multiplyByPointAsVector(enu, new Cartesian3(x, y, z), new Cartesian3()),
				new Cartesian3()
			);
		const direction = local(Math.sin(h) * Math.cos(p), Math.cos(h) * Math.cos(p), Math.sin(p));
		const right = local(Math.cos(h), -Math.sin(h), 0);
		const up = Cartesian3.cross(right, direction, new Cartesian3());
		const position = Cartesian3.subtract(
			summit,
			Cartesian3.multiplyByScalar(direction, range, new Cartesian3()),
			new Cartesian3()
		);
		const frustum = new PerspectiveFrustum({
			fov: cesium.Math.toRadians(60),
			aspectRatio: WIDE.width / WIDE.height,
			near: 1,
			far: 1e9
		});
		const viewer = {
			isDestroyed: () => false,
			camera: { positionWC: position, directionWC: direction, upWC: up, rightWC: right, frustum },
			scene: {
				canvas: { clientWidth: WIDE.width, clientHeight: WIDE.height },
				// Flat ground: only the globe's curve can hide a summit here.
				globe: { ellipsoid: cesium.Ellipsoid.WGS84, pick: () => undefined }
			}
		};

		return new ViewSampler(cesium as unknown as CesiumModule, viewer as unknown as Viewer);
	}

	const inStage = (sighting: { kind: string; x?: number; y?: number }) =>
		sighting.kind === 'ahead' &&
		sighting.x! >= 0 &&
		sighting.x! <= WIDE.width &&
		sighting.y! >= 0 &&
		sighting.y! <= WIDE.height;

	function read(range: number) {
		const sampler = viewFrom(range);
		const entries = (Object.keys(NEIGHBOURS) as Slug[]).map((slug) => {
			const position = NEIGHBOURS[slug];
			return [
				slug,
				{
					sighting: sampler.sight(position),
					concealed: sampler.concealment(position),
					bearing: sampler.sightBearing(position)
				}
			] as const;
		});
		return Object.fromEntries(entries) as Record<Slug, (typeof entries)[number][1]>;
	}

	it('finds all three in the frame and beyond the horizon, each with a bearing in the frame', () => {
		const view = read(4750);

		for (const { sighting, concealed, bearing } of Object.values(view)) {
			expect(inStage(sighting)).toBe(true);
			expect(concealed).toBe('horizon');
			expect(inStage(bearing)).toBe(true);
			// The bearing stands above the projected summit: at eye level, not on the nearer terrain.
			if (bearing.kind === 'ahead' && sighting.kind === 'ahead') {
				expect(bearing.y).toBeLessThan(sighting.y);
			}
		}
	});

	it('orders the bearings across the stage as the summits lie: Eiger, Mont Blanc, Matterhorn, all right of centre', () => {
		const view = read(4750);
		const x = (slug: Slug) => {
			const { bearing } = view[slug];
			return bearing.kind === 'ahead' ? bearing.x : Number.NaN;
		};

		expect(x('eiger')).toBeGreaterThan(WIDE.width / 2);
		expect(x('eiger')).toBeLessThan(x('mont-blanc'));
		expect(x('mont-blanc')).toBeLessThan(x('matterhorn'));
	});

	it('sees Mont Blanc first when zooming out, the Matterhorn and the Eiger still beyond the horizon', () => {
		const view = read(200_000);

		expect(view['mont-blanc'].concealed).toBeUndefined();
		expect(inStage(view['mont-blanc'].sighting)).toBe(true);
		expect(view.matterhorn.concealed).toBe('horizon');
		expect(view.eiger.concealed).toBe('horizon');
		expect(inStage(view.matterhorn.bearing)).toBe(true);
		expect(inStage(view.eiger.bearing)).toBe(true);
	});

	it('sees all three from far enough out, and loses them behind the horizon again on the way back in', () => {
		const far = read(800_000);
		const back = read(4750);

		for (const slug of Object.keys(NEIGHBOURS) as Slug[]) {
			expect(far[slug].concealed).toBeUndefined();
			expect(inStage(far[slug].sighting)).toBe(true);
			expect(back[slug].concealed).toBe('horizon');
		}
	});
});

describe('ViewSampler.sightBearing', () => {
	it('gives no bearing once the viewer is gone, or without a perspective frustum', () => {
		const point = Cartesian3.fromDegrees(-68.541, -27.109, 6893);
		const withGlobe = (camera: ReturnType<typeof cameraAt>, destroyed = false) =>
			new ViewSampler(
				cesium as unknown as CesiumModule,
				{
					isDestroyed: () => destroyed,
					camera,
					scene: {
						canvas: { clientWidth: STAGE.width, clientHeight: STAGE.height },
						globe: { ellipsoid: cesium.Ellipsoid.WGS84 }
					}
				} as unknown as Viewer
			);
		const orthographic = new cesium.OrthographicFrustum({ width: 1000, aspectRatio: 1.6 });

		expect(withGlobe(cameraAt(10, -25, perspective()), true).sightBearing(point)).toEqual({
			kind: 'unknown'
		});
		expect(withGlobe(cameraAt(10, -25, orthographic)).sightBearing(point)).toEqual({
			kind: 'unknown'
		});
		expect(withGlobe(cameraAt(10, -25, perspective())).sightBearing(point).kind).toBe('ahead');
	});
});
