import * as cesium from 'cesium';
import { describe, expect, it } from 'vitest';
import { glidePeakFraction, sampleGlide, type GlidePlan, type LookState } from '../glidePath';
import { globeLook, planExploreTransition } from '../transitionPlan';
import type { CesiumModule } from './CesiumModule';
import { ViewerCameraFlight } from './ViewerCameraFlight';

const { Cartesian3, Ellipsoid } = cesium;

interface SetView {
	destination: cesium.Cartesian3;
	orientation: { direction: cesium.Cartesian3; up: cesium.Cartesian3 };
}

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

function glide(plan: ReturnType<typeof planExploreTransition>): GlidePlan {
	if (plan.mode !== 'glide') {
		throw new Error('expected a glide plan');
	}
	return plan;
}

const ATLAS_LOOK: LookState = {
	...globeLook({ latitude: 20, longitude: 10, altitudeMeters: 0 }),
	rangeMeters: 18_000_000
};

// A camera `heightMeters` above the ground at (latitude, longitude), looking straight down.
function cameraAbove(latitude: number, longitude: number, heightMeters: number) {
	const ground = Cartesian3.fromDegrees(longitude, latitude, 0);
	const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(ground, new Cartesian3());
	const position = Cartesian3.add(
		ground,
		Cartesian3.multiplyByScalar(normal, heightMeters, new Cartesian3()),
		new Cartesian3()
	);
	const direction = Cartesian3.negate(normal, new Cartesian3());
	const up = Cartesian3.normalize(
		Cartesian3.cross(
			Cartesian3.cross(direction, Cartesian3.UNIT_Z, new Cartesian3()),
			direction,
			new Cartesian3()
		),
		new Cartesian3()
	);

	return { position, direction, up };
}

function setup() {
	const camera = {
		positionWC: new Cartesian3(),
		directionWC: new Cartesian3(),
		upWC: new Cartesian3(),
		frustum: new cesium.PerspectiveFrustum({ fov: Math.PI / 3, aspectRatio: 1000 / 600 }),
		setView(options: SetView) {
			Cartesian3.clone(options.destination, camera.positionWC);
			Cartesian3.clone(options.orientation.direction, camera.directionWC);
			Cartesian3.clone(options.orientation.up, camera.upWC);
		}
	};
	const viewer = {
		camera,
		isDestroyed: () => false,
		scene: { ellipsoid: Ellipsoid.WGS84 }
	};
	const flight = new ViewerCameraFlight(
		cesium as unknown as CesiumModule,
		viewer as never,
		{ projectFraming: () => ({ x: 0, y: 0 }) } as never,
		() => ({ width: 1000, height: 600 })
	);
	const moveCamera = (pose: ReturnType<typeof cameraAbove>) =>
		camera.setView({
			destination: pose.position,
			orientation: { direction: pose.direction, up: pose.up }
		});

	return { flight, moveCamera };
}

describe('ViewerCameraFlight.look', () => {
	it('reads a free look back while the camera stays where that look put it', () => {
		const { flight } = setup();

		expect(flight.applyLook(ATLAS_LOOK)).toBe(true);
		const look = flight.look();

		expect(look?.latitude).toBe(ATLAS_LOOK.latitude);
		expect(look?.longitude).toBe(ATLAS_LOOK.longitude);
		expect(look?.pitchDegrees).toBeCloseTo(ATLAS_LOOK.pitchDegrees, 6);
		expect(look?.headingDegrees).toBeCloseTo(ATLAS_LOOK.headingDegrees, 6);
		expect(look?.rangeMeters).toBeCloseTo(ATLAS_LOOK.rangeMeters, 0);
	});

	it('reads from the centre of the view once the camera has moved since a free look', () => {
		const { flight, moveCamera } = setup();
		flight.applyLook(ATLAS_LOOK);

		moveCamera(cameraAbove(20, -60, 15_000_000));
		const look = flight.look();

		expect(look?.latitude).toBeCloseTo(20, 6);
		expect(look?.longitude).toBeCloseTo(-60, 6);
		expect(look?.altitudeMeters).toBe(0);
		expect(look?.pitchDegrees).toBeLessThan(-89.9);
		expect(look?.rangeMeters).toBeCloseTo(15_000_000, -1);
	});

	it('keeps the free look focus when the moved camera looks past the globe', () => {
		const { flight, moveCamera } = setup();
		flight.applyLook(ATLAS_LOOK);
		const away = cameraAbove(20, -60, 15_000_000);

		moveCamera({ ...away, direction: Cartesian3.negate(away.direction, new Cartesian3()) });

		expect(flight.look()?.longitude).toBe(ATLAS_LOOK.longitude);
	});

	it('lets a glide interrupted at its apex be re-planned from exactly where it stopped', () => {
		const { flight } = setup();
		const interrupted = glide(planExploreTransition(ACONCAGUA, EVEREST, 'full'));
		const apex = sampleGlide(interrupted, glidePeakFraction(interrupted));
		flight.applyLook(apex);

		const origin = flight.look();
		const replanned = glide(planExploreTransition(origin, ACONCAGUA, 'full'));
		const first = sampleGlide(replanned, 0);

		expect(first.latitude).toBeCloseTo(apex.latitude, 6);
		expect(first.longitude).toBeCloseTo(apex.longitude, 6);
		expect(first.headingDegrees).toBeCloseTo(apex.headingDegrees, 4);
		expect(first.pitchDegrees).toBeCloseTo(apex.pitchDegrees, 4);
		expect(first.rangeMeters / apex.rangeMeters).toBeCloseTo(1, 6);
	});
});
