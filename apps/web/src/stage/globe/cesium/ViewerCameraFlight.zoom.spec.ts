import * as cesium from 'cesium';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { zoomProgress } from '../zoomStep';
import type { CesiumModule } from './CesiumModule';
import { ViewerCameraFlight } from './ViewerCameraFlight';

const { Cartesian3, Cartographic } = cesium;

// The camera looks down a fixed line of sight from 50 km up, at a point on the ground.
const GROUND = Cartesian3.fromDegrees(10, 20, 1_000);
const START = Cartesian3.fromDegrees(10, 20.3, 50_000);
const DIRECTION = Cartesian3.normalize(
	Cartesian3.subtract(GROUND, START, new Cartesian3()),
	new Cartesian3()
);
const UP = Cartesian3.normalize(
	Cartesian3.cross(
		Cartesian3.cross(DIRECTION, GROUND, new Cartesian3()),
		DIRECTION,
		new Cartesian3()
	),
	new Cartesian3()
);

interface SetView {
	destination: cesium.Cartesian3;
	orientation: { direction: cesium.Cartesian3; up: cesium.Cartesian3 };
}

function setup({ groundHeight = 0 }: { groundHeight?: number } = {}) {
	const listeners = new Set<() => void>();
	const views: SetView[] = [];
	const camera = {
		positionWC: Cartesian3.clone(START),
		directionWC: Cartesian3.clone(DIRECTION),
		upWC: Cartesian3.clone(UP),
		getPickRay: () => ({}),
		pickEllipsoid: () => GROUND,
		flyTo: vi.fn(),
		cancelFlight: vi.fn(),
		setView(options: SetView) {
			views.push({
				destination: Cartesian3.clone(options.destination),
				orientation: {
					direction: Cartesian3.clone(options.orientation.direction),
					up: Cartesian3.clone(options.orientation.up)
				}
			});
			Cartesian3.clone(options.destination, camera.positionWC);
		}
	};
	const viewer = {
		camera,
		isDestroyed: () => false,
		scene: {
			canvas: { clientWidth: 1000, clientHeight: 600 },
			ellipsoid: cesium.Ellipsoid.WGS84,
			globe: { pick: () => GROUND, getHeight: () => groundHeight },
			screenSpaceCameraController: { enableInputs: true },
			preUpdate: {
				addEventListener(listener: () => void) {
					listeners.add(listener);
					return () => listeners.delete(listener);
				}
			}
		}
	};
	const flight = new ViewerCameraFlight(
		cesium as unknown as CesiumModule,
		viewer as never,
		{} as never,
		() => ({ width: 1000, height: 600 })
	);
	const frame = () => [...listeners].forEach((listener) => listener());

	return { flight, camera, views, listeners, frame };
}

function lineOfSight(view: SetView) {
	return {
		direction: view.orientation.direction,
		up: view.orientation.up
	};
}

describe('ViewerCameraFlight.zoom', () => {
	let now = 0;

	beforeEach(() => {
		now = 1_000;
		vi.spyOn(performance, 'now').mockImplementation(() => now);
	});

	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('slides along one fixed line of sight with a constant orientation, never flying', () => {
		const { flight, camera, views, frame } = setup();

		expect(flight.zoom('out', 0.5)).toBe('zoomed');
		for (let step = 0; step <= 10; step += 1) {
			now = 1_000 + step * 50;
			frame();
		}

		expect(camera.flyTo).not.toHaveBeenCalled();
		expect(views.length).toBeGreaterThan(3);
		for (const view of views) {
			const { direction, up } = lineOfSight(view);
			expect(Cartesian3.equalsEpsilon(direction, DIRECTION, 1e-12)).toBe(true);
			expect(Cartesian3.equalsEpsilon(up, UP, 1e-12)).toBe(true);
			const offset = Cartesian3.subtract(view.destination, START, new Cartesian3());
			const along = Cartesian3.dot(offset, DIRECTION);
			const off = Cartesian3.magnitude(
				Cartesian3.subtract(
					offset,
					Cartesian3.multiplyByScalar(DIRECTION, along, new Cartesian3()),
					new Cartesian3()
				)
			);
			expect(off).toBeLessThan(1e-3);
		}
		const distances = views.map((view) => Cartesian3.distance(view.destination, START));
		expect(distances).toEqual([...distances].sort((a, b) => a - b));
		const focusDistance = Cartesian3.distance(START, GROUND);
		expect(distances.at(-1)).toBeCloseTo(focusDistance, 0);
	});

	// A software renderer can finish only a handful of frames inside the flight; whatever frames
	// arrive, the dolly keeps its line of sight and ends on the same destination.
	it.each([
		['every 16 ms', Array.from({ length: 33 }, (_, index) => index * 16)],
		['three frames', [0, 200, 520]],
		['one late frame after the start', [0, 5_000]]
	])('keeps its orientation and ends on the destination with frames %s', (_name, times) => {
		const { flight, camera, views, listeners, frame } = setup();
		const focusDistance = Cartesian3.distance(START, GROUND);

		flight.zoom('out', 0.5);
		for (const time of times) {
			now = 1_000 + time;
			frame();
		}

		expect(views).toHaveLength(times.length);
		for (const view of views) {
			expect(Cartesian3.equalsEpsilon(view.orientation.direction, DIRECTION, 1e-12)).toBe(true);
			expect(Cartesian3.equalsEpsilon(view.orientation.up, UP, 1e-12)).toBe(true);
		}
		const distances = views.map((view) => Cartesian3.distance(view.destination, START));
		expect(distances).toEqual([...distances].sort((a, b) => a - b));
		expect(Cartesian3.distance(camera.positionWC, START)).toBeCloseTo(focusDistance, 0);
		expect(listeners.size).toBe(0);
	});

	it('places the camera on the eased progress at each moment of the flight', () => {
		const { flight, views, frame } = setup();
		const focusDistance = Cartesian3.distance(START, GROUND);
		const fractions = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1];

		flight.zoom('out', 0.5);
		for (const fraction of fractions) {
			now = 1_000 + fraction * 500;
			frame();
		}

		const travelled = views.map((view) => Cartesian3.distance(view.destination, START));
		fractions.forEach((fraction, index) => {
			expect(travelled[index]).toBeCloseTo(focusDistance * zoomProgress(fraction), 3);
		});
	});

	it('removes its frame listener when it completes', () => {
		const { flight, listeners, frame } = setup();

		flight.zoom('in', 0.5);
		expect(listeners.size).toBe(1);
		frame();
		now += 600;
		frame();

		expect(listeners.size).toBe(0);
	});

	it('applies the step at once and registers nothing when the duration is zero', () => {
		const { flight, listeners, views } = setup();

		expect(flight.zoom('out', 0)).toBe('zoomed');

		expect(views).toHaveLength(1);
		expect(listeners.size).toBe(0);
	});

	it('starts a new step from where the last one has got to, with one listener', () => {
		const { flight, listeners, frame, camera } = setup();

		flight.zoom('out', 0.5);
		now += 250;
		frame();
		const midway = Cartesian3.clone(camera.positionWC);
		flight.zoom('out', 0.5);

		expect(listeners.size).toBe(1);
		frame();
		now += 600;
		frame();
		expect(Cartesian3.distance(camera.positionWC, midway)).toBeGreaterThan(1_000);
	});

	it.each([
		['release', (flight: ViewerCameraFlight) => flight.release()],
		['cancel', (flight: ViewerCameraFlight) => flight.cancel()],
		[
			'jump',
			(flight: ViewerCameraFlight) =>
				flight.jump(
					{ slug: 'a', name: 'A', latitude: 1, longitude: 1, elevationMeters: 10 },
					{
						headingRadians: 0,
						pitchRadians: -0.3,
						rollRadians: 0,
						rangeMeters: 5_000,
						framingX: 0,
						framingY: 0
					}
				)
		]
	])('stops the dolly on %s', (_name, interrupt) => {
		const { flight, listeners, camera } = setup();
		(camera as unknown as { viewBoundingSphere: () => void }).viewBoundingSphere = () => {};
		flight.zoom('out', 0.5);
		expect(listeners.size).toBe(1);

		try {
			interrupt(flight);
		} catch {
			// The jump needs a real scene; what matters is that the dolly let go first.
		}

		expect(listeners.size).toBe(0);
	});

	it('lets go when something else moved the camera, without moving it back', () => {
		const { flight, listeners, frame, camera } = setup();
		flight.zoom('out', 0.5);
		now += 100;
		frame();

		camera.positionWC = Cartesian3.add(
			camera.positionWC,
			new Cartesian3(5_000, 0, 0),
			new Cartesian3()
		);
		const moved = Cartesian3.clone(camera.positionWC);
		now += 100;
		frame();

		expect(listeners.size).toBe(0);
		expect(Cartesian3.equals(camera.positionWC, moved)).toBe(true);
	});

	it('lets go when something else turned the camera, without turning it back', () => {
		const { flight, listeners, views, frame, camera } = setup();
		flight.zoom('out', 0.5);
		now += 100;
		frame();

		camera.directionWC = Cartesian3.normalize(
			Cartesian3.add(camera.directionWC, UP, new Cartesian3()),
			new Cartesian3()
		);
		const turned = Cartesian3.clone(camera.directionWC);
		const applied = views.length;
		now += 100;
		frame();

		expect(listeners.size).toBe(0);
		expect(views).toHaveLength(applied);
		expect(Cartesian3.equals(camera.directionWC, turned)).toBe(true);
	});

	it('stops short of the terrain on the line of sight instead of lifting the view', () => {
		const { flight, views, frame } = setup({ groundHeight: 49_000 });

		expect(flight.zoom('in', 0.5)).toBe('zoomed');
		now += 600;
		frame();

		const end = views.at(-1)!.destination;
		const height = Cartographic.fromCartesian(end).height;
		expect(height).toBeGreaterThanOrEqual(49_000 + 50 - 1);
		expect(Cartesian3.equalsEpsilon(views.at(-1)!.orientation.direction, DIRECTION, 1e-12)).toBe(
			true
		);
	});

	it('reports a limit and moves nothing when already as close as allowed', () => {
		const { flight, listeners, views, camera } = setup();
		camera.positionWC = Cartesian3.fromDegrees(10, 20, 1_200);

		expect(flight.zoom('in', 0.5)).toBe('limit');
		expect(listeners.size).toBe(0);
		expect(views).toHaveLength(0);
	});
});
