import * as cesium from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { atlasOverviewLook, ATLAS_VIEW, overviewRangeMeters } from '../atlasView';
import type { CesiumModule } from './CesiumModule';
import { ViewerCameraFlight } from './ViewerCameraFlight';

const { Cartesian3, Ellipsoid, Math: CesiumMath } = cesium;

interface SetView {
	destination: cesium.Cartesian3;
	orientation: { direction: cesium.Cartesian3; up: cesium.Cartesian3 };
}

// A camera above the globe at `longitude`, looking straight at its centre from `rangeMeters` off the surface.
function overviewCamera(longitude: number, rangeMeters: number) {
	const focus = Cartesian3.fromDegrees(longitude, 20, 0);
	const normal = Ellipsoid.WGS84.geodeticSurfaceNormal(focus, new Cartesian3());
	const position = Cartesian3.add(
		focus,
		Cartesian3.multiplyByScalar(normal, rangeMeters, new Cartesian3()),
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

	return { focus, position, direction, up };
}

function setup(longitude: number, rangeMeters: number, destroyed = false) {
	const start = overviewCamera(longitude, rangeMeters);
	const views: SetView[] = [];
	const camera = {
		positionWC: Cartesian3.clone(start.position),
		directionWC: Cartesian3.clone(start.direction),
		upWC: Cartesian3.clone(start.up),
		setView(options: SetView) {
			views.push({
				destination: Cartesian3.clone(options.destination),
				orientation: {
					direction: Cartesian3.clone(options.orientation.direction),
					up: Cartesian3.clone(options.orientation.up)
				}
			});
			Cartesian3.clone(options.destination, camera.positionWC);
		},
		flyTo: vi.fn(),
		cancelFlight: vi.fn()
	};
	const viewer = {
		camera,
		isDestroyed: () => destroyed,
		scene: { ellipsoid: Ellipsoid.WGS84 }
	};
	const flight = new ViewerCameraFlight(
		cesium as unknown as CesiumModule,
		viewer as never,
		{} as never,
		() => ({ width: 1000, height: 600 })
	);

	return { flight, camera, views, start };
}

const rangeOf = (camera: { positionWC: cesium.Cartesian3 }, focus: cesium.Cartesian3) =>
	Cartesian3.distance(camera.positionWC, focus);

describe('ViewerCameraFlight.setRange', () => {
	it('moves along the line of sight to the wanted range, keeping the axes and the focus', () => {
		const { flight, camera, views, start } = setup(10, 20_000_000);

		expect(flight.setRange(15_000_000)).toBe(true);

		expect(views).toHaveLength(1);
		expect(rangeOf(camera, start.focus)).toBeCloseTo(15_000_000, 0);
		expect(Cartesian3.equalsEpsilon(views[0]!.orientation.direction, start.direction, 1e-12)).toBe(
			true
		);
		expect(Cartesian3.equalsEpsilon(views[0]!.orientation.up, start.up, 1e-12)).toBe(true);
		const toFocus = Cartesian3.normalize(
			Cartesian3.subtract(start.focus, camera.positionWC, new Cartesian3()),
			new Cartesian3()
		);
		expect(Cartesian3.equalsEpsilon(toFocus, start.direction, 1e-9)).toBe(true);
	});

	it('moves outward as readily as inward', () => {
		const { flight, camera, start } = setup(10, 12_000_000);

		expect(flight.setRange(30_000_000)).toBe(true);

		expect(rangeOf(camera, start.focus)).toBeCloseTo(30_000_000, 0);
	});

	// The orbit turns the camera about the polar axis, so the view is no longer over the editorial centre.
	it.each([10, -75, 170])('keeps the longitude it was turned to (%d°)', (longitude) => {
		const { flight, camera } = setup(longitude, 20_000_000);

		flight.setRange(14_000_000);

		const here = Ellipsoid.WGS84.cartesianToCartographic(camera.positionWC)!;
		expect(CesiumMath.toDegrees(here.longitude)).toBeCloseTo(longitude, 6);
		expect(CesiumMath.toDegrees(here.latitude)).toBeCloseTo(20, 1);
	});

	it('fits the overview range for a stage, whichever way it is shaped', () => {
		for (const stage of [
			{ width: 390, height: 520 },
			{ width: 900, height: 360 }
		]) {
			const { flight, camera, start } = setup(10, 20_000_000);
			const wanted = atlasOverviewLook(ATLAS_VIEW, stage).rangeMeters;

			flight.setRange(overviewRangeMeters(stage));

			expect(rangeOf(camera, start.focus)).toBeCloseTo(wanted, 0);
		}
	});

	it('does not touch a camera already at the range', () => {
		const { flight, views } = setup(10, 20_000_000);

		expect(flight.setRange(20_000_000 * (1 + 5e-5))).toBe(true);

		expect(views).toEqual([]);
	});

	it('declines a range that is not positive', () => {
		const { flight, views } = setup(10, 20_000_000);

		expect(flight.setRange(0)).toBe(false);
		expect(flight.setRange(Number.NaN)).toBe(false);
		expect(views).toEqual([]);
	});

	it('declines when the camera looks away from the globe', () => {
		const { flight, camera, views } = setup(10, 20_000_000);
		Cartesian3.negate(camera.directionWC, camera.directionWC);

		expect(flight.setRange(15_000_000)).toBe(false);
		expect(views).toEqual([]);
	});

	it('declines once the viewer is destroyed', () => {
		const { flight, views } = setup(10, 20_000_000, true);

		expect(flight.setRange(15_000_000)).toBe(false);
		expect(views).toEqual([]);
	});
});
