import * as cesium from 'cesium';
import { describe, expect, it, vi } from 'vitest';
import { ATLAS_MARKER_STYLE, type AtlasMarker, type ScreenBox } from '../atlasMarkers';
import { LABEL_DECLUTTER } from '../labelDeclutter';
import { CONTROL_GUTTER_REM, MARKER_LABEL_PLATE, SUMMIT_MARKER_STYLE } from '../marker';
import { MARKER_HIT, resolveMarkerHit } from '../markerHits';
import { ATLAS_LAYER_NAME, AtlasMarkers } from './AtlasMarkers';
import type { CesiumModule } from './CesiumModule';

const { Cartesian2, Cartesian3, DataSourceCollection, Ellipsoid, EntityCollection, JulianDate } =
	cesium;

// The collection takes a data source a microtask after it is added, as Cesium's own does.
const attached = () => new Promise<void>((resolve) => setTimeout(resolve));

const VERTICAL_FOV_RADIANS = Math.PI / 3;
const NOW = JulianDate.now();

const OLYMPUS: AtlasMarker = {
	slug: 'mount-olympus',
	name: 'Mount Olympus',
	latitude: 40.0857,
	longitude: 22.3583,
	elevationMeters: 2918
};
const ACONCAGUA: AtlasMarker = {
	slug: 'aconcagua',
	name: 'Aconcagua',
	latitude: -32.6531,
	longitude: -70.012,
	elevationMeters: 6961
};
const MONT_BLANC: AtlasMarker = {
	slug: 'mont-blanc',
	name: 'Mont Blanc',
	latitude: 45.8326,
	longitude: 6.8652,
	elevationMeters: 4806
};

// Two summits 4.6 km apart on the Argentina-Chile border, the closest pair in the catalog.
const FITZ_ROY: AtlasMarker = {
	slug: 'fitz-roy',
	name: 'Fitz Roy',
	latitude: -49.2712498,
	longitude: -73.0432115,
	elevationMeters: 3405
};
const CERRO_TORRE: AtlasMarker = {
	slug: 'cerro-torre',
	name: 'Cerro Torre',
	latitude: -49.2906,
	longitude: -73.09901,
	elevationMeters: 3133
};

// Close to the system face at 13 px: decluttering only needs plates of a realistic size.
const CHARACTER_PIXELS = 7;
const TEXT_HEIGHT_PIXELS = 13;
function measureText(text: string) {
	return { width: text.length * CHARACTER_PIXELS, height: TEXT_HEIGHT_PIXELS };
}

const PILL_WIDTH = 160;
const PILL_HEIGHT = 62;
const PILL_INSET = 14;

function dotSprite(state: string, ratio: number) {
	return { image: `dot:${state}@${ratio}`, width: 14, height: 14, bottomInset: 0 };
}

// The pill resolves on a later turn, as drawing waits for fonts; `hold` keeps it from resolving.
function fakeSprites() {
	const waiting: (() => void)[] = [];
	let hold = false;
	const pill = vi.fn(async (name: string) => {
		if (hold) {
			await new Promise<void>((resolve) => waiting.push(resolve));
		}
		return {
			image: `pill:${name}`,
			width: PILL_WIDTH,
			height: PILL_HEIGHT,
			bottomInset: PILL_INSET
		};
	});

	return {
		dot: vi.fn(dotSprite),
		pill,
		holdPills: () => {
			hold = true;
		},
		releasePills: () => {
			hold = false;
			waiting.splice(0).forEach((resolve) => resolve());
		}
	};
}

function boxesOverlap(a: ScreenBox, b: ScreenBox): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

interface FakeCamera {
	positionWC: cesium.Cartesian3;
	directionWC: cesium.Cartesian3;
	upWC: cesium.Cartesian3;
}

function surfaceFrame(latitude: number, longitude: number) {
	const frame = cesium.Transforms.eastNorthUpToFixedFrame(
		Cartesian3.fromDegrees(longitude, latitude)
	);
	const column = (index: number) =>
		Cartesian3.normalize(
			cesium.Matrix4.getColumn(frame, index, new cesium.Cartesian4()) as never,
			new Cartesian3()
		);

	return { east: column(0), north: column(1), up: column(2) };
}

function lookDown(camera: FakeCamera, latitude: number, longitude: number, heightMeters: number) {
	const { north, up } = surfaceFrame(latitude, longitude);
	Cartesian3.clone(Cartesian3.fromDegrees(longitude, latitude, heightMeters), camera.positionWC);
	Cartesian3.negate(up, camera.directionWC);
	Cartesian3.clone(north, camera.upWC);
}

function lookNorth(camera: FakeCamera, latitude: number, longitude: number, heightMeters: number) {
	const { north, up } = surfaceFrame(latitude, longitude);
	Cartesian3.clone(Cartesian3.fromDegrees(longitude, latitude, heightMeters), camera.positionWC);
	Cartesian3.clone(north, camera.directionWC);
	Cartesian3.clone(up, camera.upWC);
}

// A bare pinhole, deliberately without any visibility test of its own: like a projection matrix,
// it places points behind the camera or beyond the horizon somewhere on the image plane too.
function pinhole(camera: FakeCamera, canvas: { clientWidth: number; clientHeight: number }) {
	return (position: cesium.Cartesian3, result: cesium.Cartesian2) => {
		const toPoint = Cartesian3.subtract(position, camera.positionWC, new Cartesian3());
		const depth = Cartesian3.dot(toPoint, camera.directionWC);
		if (Math.abs(depth) < 1e-9) {
			return undefined;
		}
		const right = Cartesian3.cross(camera.directionWC, camera.upWC, new Cartesian3());
		const focal = canvas.clientHeight / 2 / Math.tan(VERTICAL_FOV_RADIANS / 2);
		result.x = canvas.clientWidth / 2 + (focal * Cartesian3.dot(toPoint, right)) / depth;
		result.y = canvas.clientHeight / 2 - (focal * Cartesian3.dot(toPoint, camera.upWC)) / depth;

		return result;
	};
}

function setup() {
	const camera: FakeCamera = {
		positionWC: new Cartesian3(),
		directionWC: new Cartesian3(),
		upWC: new Cartesian3()
	};
	lookDown(camera, 20, 10, 11_000_000);
	const canvas = { clientWidth: 800, clientHeight: 600 };
	let destroyed = false;
	const viewer = {
		camera,
		entities: new EntityCollection(),
		dataSources: new DataSourceCollection(),
		scene: {
			canvas,
			globe: { ellipsoid: Ellipsoid.WGS84, depthTestAgainstTerrain: false }
		},
		isDestroyed: () => destroyed
	};
	const listeners = new Set<() => void>();
	const listen = vi.fn((onChange: () => void) => {
		listeners.add(onChange);
		return () => {
			listeners.delete(onChange);
		};
	});
	const project = pinhole(camera, canvas);
	const refreshed = vi.fn();
	const sprites = fakeSprites();
	const markers = new AtlasMarkers(cesium as unknown as CesiumModule, viewer as never, {
		listen,
		project,
		measureText,
		sprites,
		refreshed
	});

	return {
		markers,
		viewer,
		camera,
		canvas,
		listen,
		listeners,
		project,
		refreshed,
		sprites,
		/** What the scene's view-change listener does after the camera moved or the canvas resized. */
		viewChanged: () => [...listeners].forEach((listener) => listener()),
		destroyViewer: () => {
			destroyed = true;
		},
		layer: () => viewer.dataSources.getByName(ATLAS_LAYER_NAME)[0],
		entity: (slug: string) =>
			viewer.dataSources.getByName(ATLAS_LAYER_NAME)[0]?.entities.getById(slug),
		visible: () =>
			markers
				.read()!
				.markers.filter((marker) => marker.visible)
				.map((marker) => marker.slug)
				.sort()
	};
}

describe('AtlasMarkers layer', () => {
	it('creates nothing until markers are set, as on a mountain page', async () => {
		const { markers, viewer, listen } = setup();

		markers.set(undefined);

		expect(viewer.dataSources.length).toBe(0);
		expect(listen).not.toHaveBeenCalled();
		expect(markers.read()).toMatchObject({ shown: false, layers: 0, entities: 0, markers: [] });
	});

	it('adds one entity per marker, keyed by slug, in its own data source', async () => {
		const { markers, viewer, layer } = setup();

		markers.set([OLYMPUS, ACONCAGUA, MONT_BLANC]);
		await attached();

		expect(viewer.dataSources.length).toBe(1);
		expect(
			layer()!
				.entities.values.map((entity) => entity.id)
				.sort()
		).toEqual(['aconcagua', 'mont-blanc', 'mount-olympus']);
		expect(viewer.entities.values).toHaveLength(0);
		expect(markers.read()).toMatchObject({ shown: true, layers: 1, entities: 3 });
	});

	it('places each marker at its catalog elevation, unclamped, with no depth override', async () => {
		const { markers, entity } = setup();

		markers.set([MONT_BLANC]);
		await attached();

		const marker = entity(MONT_BLANC.slug)!;
		expect(marker.position!.getValue(NOW)).toEqual(
			Cartesian3.fromDegrees(MONT_BLANC.longitude, MONT_BLANC.latitude, MONT_BLANC.elevationMeters)
		);
		expect(marker.billboard!.heightReference!.getValue(NOW)).toBe(cesium.HeightReference.NONE);
		expect(marker.label!.heightReference!.getValue(NOW)).toBe(cesium.HeightReference.NONE);
		expect(marker.billboard!.disableDepthTestDistance).toBeUndefined();
		expect(marker.label!.disableDepthTestDistance).toBeUndefined();
	});

	it('labels a marker with its name only, within the label distance', async () => {
		const { markers, entity } = setup();

		markers.set([MONT_BLANC]);
		await attached();

		const label = entity(MONT_BLANC.slug)!.label!;
		expect(label.text!.getValue(NOW)).toBe('Mont Blanc');
		expect(label.distanceDisplayCondition!.getValue(NOW)).toEqual(
			new cesium.DistanceDisplayCondition(0, ATLAS_MARKER_STYLE.labelMaxMeters)
		);
	});

	it('draws every marker the same: one shared resting dot sprite, no point', async () => {
		const { markers, entity, sprites } = setup();

		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		for (const marker of [OLYMPUS, ACONCAGUA]) {
			const { billboard, point } = entity(marker.slug)!;
			expect(point).toBeUndefined();
			expect(billboard!.image!.getValue(NOW)).toBe('dot:rest@1');
			expect(billboard!.scaleByDistance!.getValue(NOW)).toEqual(
				new cesium.NearFarScalar(
					ATLAS_MARKER_STYLE.pointNearMeters,
					1,
					ATLAS_MARKER_STYLE.pointFarMeters,
					ATLAS_MARKER_STYLE.pointFarScale
				)
			);
		}
		expect(new Set(sprites.dot.mock.calls.map(([state]) => state))).toEqual(new Set(['rest']));
	});

	it('sets each label on a dark plate with light text, and fades it in with distance', async () => {
		const { markers, entity } = setup();

		markers.set([MONT_BLANC]);
		await attached();

		const label = entity(MONT_BLANC.slug)!.label!;
		const plate = label.backgroundColor!.getValue(NOW) as cesium.Color;
		expect(label.showBackground!.getValue(NOW)).toBe(true);
		expect(plate.alpha).toBeGreaterThanOrEqual(0.75);
		expect(plate.alpha).toBeLessThanOrEqual(0.8);
		expect(Math.max(plate.red, plate.green, plate.blue)).toBeLessThan(0.1);
		expect((label.fillColor!.getValue(NOW) as cesium.Color).red).toBeGreaterThan(0.9);
		expect(plate).toEqual(
			cesium.Color.fromCssColorString(MARKER_LABEL_PLATE.color).withAlpha(MARKER_LABEL_PLATE.alpha)
		);
		const fade = label.translucencyByDistance!.getValue(NOW) as cesium.NearFarScalar;
		expect(fade).toEqual(
			new cesium.NearFarScalar(
				ATLAS_MARKER_STYLE.labelFullMeters,
				1,
				ATLAS_MARKER_STYLE.labelMaxMeters,
				0
			)
		);
		expect(ATLAS_MARKER_STYLE.labelFullMeters).toBeLessThan(ATLAS_MARKER_STYLE.labelMaxMeters);
	});

	it('shows an empty layer for an empty index', async () => {
		const { markers } = setup();

		markers.set([]);
		await attached();

		expect(markers.read()).toMatchObject({ shown: true, layers: 1, entities: 0, markers: [] });
	});

	it('leaves the terrain depth test as the scene has it', async () => {
		const { markers, viewer } = setup();

		markers.set([OLYMPUS]);
		await attached();

		expect(viewer.scene.globe.depthTestAgainstTerrain).toBe(false);
		expect(markers.read()!.depthTestAgainstTerrain).toBe(false);
	});
});

describe('AtlasMarkers visibility', () => {
	it('hides a marker beyond the horizon though it projects inside the canvas', async () => {
		const { markers, project, entity, visible } = setup();

		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		const projected = project(
			Cartesian3.fromDegrees(ACONCAGUA.longitude, ACONCAGUA.latitude, ACONCAGUA.elevationMeters),
			new Cartesian2()
		)!;
		expect(projected.x).toBeGreaterThan(0);
		expect(projected.x).toBeLessThan(800);
		expect(projected.y).toBeGreaterThan(0);
		expect(projected.y).toBeLessThan(600);
		expect(visible()).toEqual(['mount-olympus']);
		expect(entity(ACONCAGUA.slug)!.show).toBe(false);
		expect(entity(OLYMPUS.slug)!.show).toBe(true);
	});

	it('hides a marker in front of the camera and above the horizon but outside the canvas', async () => {
		const { markers, camera, viewChanged, visible } = setup();
		markers.set([OLYMPUS, MONT_BLANC]);
		await attached();

		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude, 1_000_000);
		viewChanged();

		expect(visible()).toEqual(['mont-blanc']);
	});

	it('hides a marker behind the camera though its mirror image lands inside the canvas', async () => {
		const { markers, camera, viewChanged, project, visible } = setup();
		const south = { ...MONT_BLANC, slug: 'south', latitude: 45.38, elevationMeters: 4000 };
		const north = { ...MONT_BLANC, slug: 'north', latitude: 46.28, elevationMeters: 4000 };
		markers.set([south, north]);
		await attached();

		lookNorth(camera, MONT_BLANC.latitude, MONT_BLANC.longitude, 3000);
		viewChanged();

		const mirrored = project(
			Cartesian3.fromDegrees(south.longitude, south.latitude, south.elevationMeters),
			new Cartesian2()
		)!;
		expect(mirrored.x).toBeCloseTo(400, 0);
		expect(mirrored.y).toBeGreaterThan(0);
		expect(mirrored.y).toBeLessThan(600);
		expect(visible()).toEqual(['north']);
	});

	it('reports where each visible marker projects, and no position for hidden ones', async () => {
		const { markers, project } = setup();

		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		const expected = project(
			Cartesian3.fromDegrees(OLYMPUS.longitude, OLYMPUS.latitude, OLYMPUS.elevationMeters),
			new Cartesian2()
		)!;
		const reading = markers.read()!;
		expect(reading.markers.find((marker) => marker.slug === OLYMPUS.slug)!.window).toEqual({
			x: expected.x,
			y: expected.y
		});
		expect(
			reading.markers.find((marker) => marker.slug === ACONCAGUA.slug)!.window
		).toBeUndefined();
	});

	it('follows the camera as it turns to the other side of the globe', async () => {
		const { markers, camera, viewChanged, visible } = setup();
		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();
		expect(visible()).toEqual(['mount-olympus']);

		lookDown(camera, -20, -60, 11_000_000);
		viewChanged();

		expect(visible()).toEqual(['aconcagua']);
	});

	it('rejects a marker the canvas no longer covers after a resize, and takes it back after', async () => {
		const { markers, camera, canvas, viewChanged, visible } = setup();
		const east = { ...MONT_BLANC, slug: 'east', longitude: MONT_BLANC.longitude + 7.7 };
		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude, 1_000_000);
		markers.set([MONT_BLANC, east]);
		await attached();
		expect(visible()).toEqual(['east', 'mont-blanc']);

		canvas.clientWidth = 500;
		viewChanged();
		expect(visible()).toEqual(['mont-blanc']);

		canvas.clientWidth = 800;
		viewChanged();
		expect(visible()).toEqual(['east', 'mont-blanc']);
	});

	it('names only the markers within the label distance', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set([MONT_BLANC, OLYMPUS]);
		await attached();
		const labelled = () =>
			markers
				.read()!
				.markers.filter((marker) => marker.labelShown)
				.map((marker) => marker.slug);
		expect(labelled()).toEqual([]);

		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude, 300_000);
		viewChanged();

		expect(labelled()).toEqual(['mont-blanc']);
		const reading = markers.read()!.markers.find((marker) => marker.slug === 'mont-blanc')!;
		expect(reading.distanceMeters).toBeCloseTo(300_000 - MONT_BLANC.elevationMeters, -2);
		expect(reading.pointPixels).toBeLessThan(ATLAS_MARKER_STYLE.pointPixelSize);
	});
});

describe('AtlasMarkers label work', () => {
	const labelShown = (entity: cesium.Entity | undefined) => entity!.label!.show!.getValue(NOW);

	it('switches no label on from the overview, where none could be read', async () => {
		const { markers, entity } = setup();

		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		expect(labelShown(entity(OLYMPUS.slug))).toBe(false);
		expect(labelShown(entity(ACONCAGUA.slug))).toBe(false);
	});

	it('switches a label on within its distance and off again beyond it', async () => {
		const { markers, camera, viewChanged, entity } = setup();
		markers.set([MONT_BLANC, OLYMPUS]);
		await attached();

		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude, 300_000);
		viewChanged();
		expect(labelShown(entity(MONT_BLANC.slug))).toBe(true);
		expect(labelShown(entity(OLYMPUS.slug))).toBe(false);

		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude, 2_000_000);
		viewChanged();
		expect(labelShown(entity(MONT_BLANC.slug))).toBe(false);
	});

	it('names a marker across the whole fade ramp and not beyond it', async () => {
		const { markers, camera, viewChanged, entity } = setup();
		markers.set([MONT_BLANC]);
		await attached();
		const { labelFullMeters, labelMaxMeters } = ATLAS_MARKER_STYLE;

		for (const range of [labelFullMeters - 1, (labelFullMeters + labelMaxMeters) / 2]) {
			lookDown(
				camera,
				MONT_BLANC.latitude,
				MONT_BLANC.longitude,
				range + MONT_BLANC.elevationMeters
			);
			viewChanged();
			expect(labelShown(entity(MONT_BLANC.slug))).toBe(true);
		}

		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude, labelMaxMeters + 10_000);
		viewChanged();
		expect(labelShown(entity(MONT_BLANC.slug))).toBe(false);
	});

	it('leaves a label too faint to read out of the layout and out of reach, the marker still pressable', async () => {
		const { markers, camera, viewChanged, entity } = setup();
		markers.set([MONT_BLANC]);
		await attached();
		const { labelFullMeters, labelMaxMeters, labelMinAlpha } = ATLAS_MARKER_STYLE;
		const readableMeters =
			labelFullMeters + (1 - labelMinAlpha) * (labelMaxMeters - labelFullMeters);
		const lookFrom = (rangeMeters: number) => {
			lookDown(
				camera,
				MONT_BLANC.latitude,
				MONT_BLANC.longitude,
				rangeMeters + MONT_BLANC.elevationMeters
			);
			viewChanged();
		};

		lookFrom(readableMeters - 5_000);
		expect(markers.targets.map((target) => target.slug)).toEqual([MONT_BLANC.slug]);
		expect(markers.targets[0]!.label).toBeDefined();

		lookFrom(readableMeters + 5_000);
		const reading = markers.read()!.markers[0]!;
		expect(reading).toMatchObject({ visible: true, labelShown: false, labelSuppressed: false });
		expect(reading.label).toBeUndefined();
		expect(markers.targets.map((target) => target.slug)).toEqual([MONT_BLANC.slug]);
		expect(markers.targets[0]!.label).toBeUndefined();
		expect(labelShown(entity(MONT_BLANC.slug))).toBe(false);
	});

	it('switches off the label of a marker that leaves the view, however close', async () => {
		const { markers, camera, canvas, viewChanged, entity } = setup();
		markers.set([MONT_BLANC]);
		await attached();
		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude, 300_000);
		viewChanged();

		canvas.clientWidth = 0;
		viewChanged();

		expect(labelShown(entity(MONT_BLANC.slug))).toBe(false);
	});
});

describe('AtlasMarkers index updates', () => {
	it('keeps unchanged entities, edits changed ones and removes the ones that left', async () => {
		const { markers, entity, layer } = setup();
		markers.set([OLYMPUS, ACONCAGUA, MONT_BLANC]);
		await attached();
		const kept = entity(OLYMPUS.slug);
		const edited = entity(MONT_BLANC.slug);

		const renamed = { ...MONT_BLANC, name: 'Monte Bianco', elevationMeters: 4805 };
		const added = { ...OLYMPUS, slug: 'mytikas', name: 'Mytikas' };
		markers.set([OLYMPUS, renamed, added]);
		await attached();

		expect(
			layer()!
				.entities.values.map((value) => value.id)
				.sort()
		).toEqual(['mont-blanc', 'mount-olympus', 'mytikas']);
		expect(entity(OLYMPUS.slug)).toBe(kept);
		expect(entity(MONT_BLANC.slug)).toBe(edited);
		expect(edited!.label!.text!.getValue(NOW)).toBe('Monte Bianco');
		expect(edited!.position!.getValue(NOW)).toEqual(
			Cartesian3.fromDegrees(MONT_BLANC.longitude, MONT_BLANC.latitude, 4805)
		);
		expect(entity(ACONCAGUA.slug)).toBeUndefined();
		expect(markers.read()!.entities).toBe(3);
	});

	it('works out the visibility of new markers before they are drawn', async () => {
		const { markers, entity } = setup();
		markers.set([OLYMPUS]);
		await attached();

		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		expect(entity(ACONCAGUA.slug)!.show).toBe(false);
		expect(entity(OLYMPUS.slug)!.show).toBe(true);
	});

	it('empties the layer for an empty index without detaching it', async () => {
		const { markers, viewer } = setup();
		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		markers.set([]);
		await attached();

		expect(markers.read()).toMatchObject({ shown: true, layers: 1, entities: 0 });
		expect(viewer.dataSources.length).toBe(1);
	});

	it('keeps one listener across updates', async () => {
		const { markers, listen, listeners } = setup();

		markers.set([OLYMPUS]);
		await attached();
		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();
		markers.set([ACONCAGUA]);
		await attached();

		expect(listen).toHaveBeenCalledOnce();
		expect(listeners.size).toBe(1);
	});
});

describe('AtlasMarkers lifecycle', () => {
	it('hides the layer and stops following the camera when the markers are taken away', async () => {
		const { markers, layer, listeners, visible } = setup();
		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		markers.set(undefined);

		expect(layer()!.show).toBe(false);
		expect(listeners.size).toBe(0);
		expect(visible()).toEqual([]);
		expect(markers.read()).toMatchObject({ shown: false, layers: 1, entities: 2 });
	});

	it('comes back on the same layer, with fresh visibility, when markers are set again', async () => {
		const { markers, camera, layer, listeners, visible } = setup();
		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();
		const first = layer();
		markers.set(undefined);

		lookDown(camera, -20, -60, 11_000_000);
		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		expect(layer()).toBe(first);
		expect(layer()!.show).toBe(true);
		expect(listeners.size).toBe(1);
		expect(visible()).toEqual(['aconcagua']);
		expect(markers.read()!.layers).toBe(1);
	});

	it('removes its data source and its listener on release, once', async () => {
		const { markers, viewer, listeners } = setup();
		markers.set([OLYMPUS]);
		await attached();
		const remove = vi.spyOn(viewer.dataSources, 'remove');

		markers.release();
		markers.release();

		expect(viewer.dataSources.length).toBe(0);
		expect(remove).toHaveBeenCalledOnce();
		expect(listeners.size).toBe(0);
	});

	it('still removes a data source released before the collection took it', async () => {
		const { markers, viewer } = setup();

		markers.set([OLYMPUS]);
		markers.release();
		await attached();

		expect(viewer.dataSources.length).toBe(0);
	});

	it('ignores markers set after release', async () => {
		const { markers, viewer, listen } = setup();
		markers.release();

		markers.set([OLYMPUS]);
		await attached();

		expect(viewer.dataSources.length).toBe(0);
		expect(listen).not.toHaveBeenCalled();
	});

	it('releases quietly once the viewer is gone', async () => {
		const { markers, viewer, destroyViewer, listeners } = setup();
		markers.set([OLYMPUS]);
		await attached();
		const remove = vi.spyOn(viewer.dataSources, 'remove');
		destroyViewer();

		markers.release();

		expect(remove).not.toHaveBeenCalled();
		expect(listeners.size).toBe(0);
		expect(markers.read()).toBeUndefined();
	});
});

describe('AtlasMarkers close summits', () => {
	const PAIR = [FITZ_ROY, CERRO_TORRE];
	const MIDPOINT = {
		latitude: (FITZ_ROY.latitude + CERRO_TORRE.latitude) / 2,
		longitude: (FITZ_ROY.longitude + CERRO_TORRE.longitude) / 2
	};
	const reading = (markers: AtlasMarkers, slug: string) =>
		markers.read()!.markers.find((marker) => marker.slug === slug)!;

	it('keeps one independent entity per summit, at its own position', async () => {
		const { markers, entity } = setup();

		markers.set(PAIR);
		await attached();

		expect(entity(FITZ_ROY.slug)).not.toBe(entity(CERRO_TORRE.slug));
		for (const marker of PAIR) {
			expect(entity(marker.slug)!.position!.getValue(NOW)).toEqual(
				Cartesian3.fromDegrees(marker.longitude, marker.latitude, marker.elevationMeters)
			);
		}
	});

	it('names only the higher summit while their labels would overlap, and draws both points', async () => {
		const { markers, camera, viewChanged, entity } = setup();
		markers.set(PAIR);
		await attached();

		lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, 150_000);
		viewChanged();

		const [torre, roy] = [reading(markers, 'cerro-torre'), reading(markers, 'fitz-roy')];
		expect([torre.visible, roy.visible]).toEqual([true, true]);
		expect([roy.labelShown, torre.labelShown]).toEqual([true, false]);
		expect(torre.labelSuppressed).toBe(true);
		expect(entity('cerro-torre')!.label!.show!.getValue(NOW)).toBe(false);
		expect(
			Math.hypot(roy.window!.x - torre.window!.x, roy.window!.y - torre.window!.y)
		).toBeGreaterThan(ATLAS_MARKER_STYLE.pointPixelSize);
		expect(markers.targets.map((target) => target.slug).sort()).toEqual([
			'cerro-torre',
			'fitz-roy'
		]);
	});

	it('names both once the camera is close enough for their plates to clear each other', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();

		lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, 30_000);
		viewChanged();

		const [torre, roy] = [reading(markers, 'cerro-torre'), reading(markers, 'fitz-roy')];
		expect([torre.labelShown, roy.labelShown]).toEqual([true, true]);
		expect(boxesOverlap(torre.label!, roy.label!)).toBe(false);
	});

	it('still draws both points when they merge on screen, with one name', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();

		lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, 1_100_000);
		viewChanged();

		const [torre, roy] = [reading(markers, 'cerro-torre'), reading(markers, 'fitz-roy')];
		expect([torre.visible, roy.visible]).toEqual([true, true]);
		expect([roy.labelShown, torre.labelShown]).toEqual([true, false]);
		expect(
			Math.hypot(roy.window!.x - torre.window!.x, roy.window!.y - torre.window!.y)
		).toBeLessThan(ATLAS_MARKER_STYLE.pointPixelSize);
	});

	it('judges each summit on its own: one leaving the view does not take the other with it', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();

		lookDown(camera, FITZ_ROY.latitude, FITZ_ROY.longitude, 8_000);
		viewChanged();

		expect(reading(markers, 'fitz-roy').visible).toBe(true);
		expect(reading(markers, 'cerro-torre').visible).toBe(false);
		expect(markers.read()!.entities).toBe(2);
	});
});

describe('AtlasMarkers hit targets', () => {
	const PAIR = [FITZ_ROY, CERRO_TORRE];
	const MIDPOINT = {
		latitude: (FITZ_ROY.latitude + CERRO_TORRE.latitude) / 2,
		longitude: (FITZ_ROY.longitude + CERRO_TORRE.longitude) / 2
	};
	const at = (markers: AtlasMarkers, slug: string) =>
		markers.targets.find((target) => target.slug === slug)!;
	const hitSlugs = (hit: ReturnType<typeof resolveMarkerHit>) =>
		hit.kind === 'mountain'
			? [hit.mountain.slug]
			: hit.kind === 'choice'
				? hit.mountains.map((mountain) => mountain.slug)
				: [];

	it('lists exactly the visible markers, where the reading places them', async () => {
		const { markers } = setup();
		markers.set([OLYMPUS, MONT_BLANC, ACONCAGUA]);
		await attached();

		const reading = markers.read()!;
		const visible = reading.markers.filter((marker) => marker.visible);
		expect(markers.targets.map((target) => target.slug).sort()).toEqual(
			visible.map((marker) => marker.slug).sort()
		);
		for (const marker of visible) {
			expect(at(markers, marker.slug)).toMatchObject(marker.window!);
		}
		expect(markers.targets.some((target) => target.slug === ACONCAGUA.slug)).toBe(false);
	});

	it('never hits a marker behind the horizon, even pressed where it would project', async () => {
		const { markers, project } = setup();
		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();

		const ghost = project(
			Cartesian3.fromDegrees(ACONCAGUA.longitude, ACONCAGUA.latitude, ACONCAGUA.elevationMeters),
			new Cartesian2()
		)!;

		expect(resolveMarkerHit(markers.targets, ghost, 'coarse').kind).toBe('none');
	});

	it('never hits a marker outside the canvas, even pressed at the canvas edge nearest it', async () => {
		const { markers, camera, canvas, viewChanged } = setup();
		markers.set([MONT_BLANC]);
		await attached();

		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude - 2, 200_000);
		viewChanged();

		expect(markers.read()!.markers[0]!.visible).toBe(false);
		expect(
			resolveMarkerHit(markers.targets, { x: canvas.clientWidth, y: 300 }, 'coarse').kind
		).toBe('none');
	});

	it('lists nothing while the layer is hidden, and tells the picker', async () => {
		const { markers, refreshed } = setup();
		markers.set([OLYMPUS]);
		await attached();
		expect(markers.targets).toHaveLength(1);
		refreshed.mockClear();

		markers.set(undefined);

		expect(markers.targets).toEqual([]);
		expect(refreshed).toHaveBeenCalledOnce();
	});

	it('tells the picker after every visibility pass', async () => {
		const { markers, refreshed, viewChanged } = setup();
		markers.set([OLYMPUS]);
		refreshed.mockClear();

		viewChanged();
		viewChanged();

		expect(refreshed).toHaveBeenCalledTimes(2);
	});

	it('asks which of Fitz Roy and Cerro Torre was meant while their dots merge', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();

		lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, 1_100_000);
		viewChanged();

		const roy = at(markers, 'fitz-roy');
		expect(hitSlugs(resolveMarkerHit(markers.targets, roy, 'fine'))).toEqual([
			'fitz-roy',
			'cerro-torre'
		]);
	});

	it('opens Cerro Torre from its dot though its label gave way to Fitz Roy', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();

		lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, 150_000);
		viewChanged();

		const torre = at(markers, 'cerro-torre');
		expect(torre.label).toBeUndefined();
		expect(hitSlugs(resolveMarkerHit(markers.targets, torre, 'fine'))).toEqual(['cerro-torre']);
		expect(hitSlugs(resolveMarkerHit(markers.targets, torre, 'coarse'))).toEqual(['cerro-torre']);

		const roy = at(markers, 'fitz-roy');
		const between = { x: (roy.x + torre.x) / 2, y: (roy.y + torre.y) / 2 };
		expect(resolveMarkerHit(markers.targets, between, 'coarse').kind).toBe('choice');
	});

	it('opens each of the pair, by dot or by name, once the camera is near', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();

		lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, 30_000);
		viewChanged();

		for (const slug of ['fitz-roy', 'cerro-torre']) {
			const target = at(markers, slug);
			const label = target.label!;
			const onName = { x: (label.left + label.right) / 2, y: (label.top + label.bottom) / 2 };
			expect(hitSlugs(resolveMarkerHit(markers.targets, target, 'coarse'))).toEqual([slug]);
			expect(hitSlugs(resolveMarkerHit(markers.targets, onName, 'coarse'))).toEqual([slug]);
		}
	});

	it('separates Mont Blanc and the Matterhorn by more than a finger once regional', async () => {
		const MATTERHORN: AtlasMarker = {
			slug: 'matterhorn',
			name: 'Matterhorn',
			latitude: 45.9764263,
			longitude: 7.6586024,
			elevationMeters: 4478
		};
		const { markers, camera, viewChanged } = setup();
		markers.set([MONT_BLANC, MATTERHORN]);
		await attached();

		lookDown(camera, 45.9, 7.25, 600_000);
		viewChanged();

		const [blanc, matterhorn] = [at(markers, 'mont-blanc'), at(markers, 'matterhorn')];
		expect(Math.hypot(blanc.x - matterhorn.x, blanc.y - matterhorn.y)).toBeGreaterThan(
			MARKER_HIT.coarse.radiusPixels
		);
		expect(hitSlugs(resolveMarkerHit(markers.targets, matterhorn, 'coarse'))).toEqual([
			'matterhorn'
		]);
	});
});

describe('AtlasMarkers label declutter', () => {
	const PAIR = [FITZ_ROY, CERRO_TORRE];
	const MIDPOINT = {
		latitude: (FITZ_ROY.latitude + CERRO_TORRE.latitude) / 2,
		longitude: (FITZ_ROY.longitude + CERRO_TORRE.longitude) / 2
	};
	const torreNamed = (markers: AtlasMarkers) =>
		markers.read()!.markers.find((marker) => marker.slug === 'cerro-torre')!.labelShown;

	it('never leaves two shown plates overlapping as the camera descends', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();

		for (let height = 1_500_000; height >= 10_000; height *= 0.85) {
			lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, height);
			viewChanged();
			const plates = markers
				.read()!
				.markers.filter((marker) => marker.labelShown)
				.map((marker) => marker.label!);
			if (plates.length === 2) {
				expect(boxesOverlap(plates[0]!, plates[1]!), `at ${Math.round(height)} m`).toBe(false);
			}
		}
	});

	it('holds its choice inside the return band, so small camera moves never blink a name', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();
		const look = (height: number) => {
			lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, height);
			viewChanged();
			return torreNamed(markers);
		};

		let appears = 200_000;
		while (!look(appears)) {
			appears *= 0.995;
		}
		let disappears = appears;
		while (look(disappears)) {
			disappears *= 1.005;
		}
		expect(disappears).toBeGreaterThan(appears * 1.05);

		// Back and forth inside the band, it keeps whatever it last had.
		const band = [appears * 1.01, disappears * 0.99, appears * 1.02, disappears * 0.98];
		look(appears);
		for (const height of band) {
			expect(look(height)).toBe(true);
		}
		look(disappears);
		for (const height of band) {
			expect(look(height)).toBe(false);
		}
	});

	it('switches a suppressed label off on the entity, so it builds no glyphs', async () => {
		const { markers, camera, viewChanged, entity } = setup();
		markers.set(PAIR);
		await attached();

		lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, 150_000);
		viewChanged();

		expect(entity('fitz-roy')!.label!.show!.getValue(NOW)).toBe(true);
		expect(entity('cerro-torre')!.label!.show!.getValue(NOW)).toBe(false);
	});

	it('restores a suppressed label once its neighbour leaves the view', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set(PAIR);
		await attached();
		lookDown(camera, MIDPOINT.latitude, MIDPOINT.longitude, 150_000);
		viewChanged();
		expect(torreNamed(markers)).toBe(false);

		lookDown(camera, CERRO_TORRE.latitude, CERRO_TORRE.longitude - 0.25, 30_000);
		viewChanged();

		const reading = markers.read()!.markers;
		expect(reading.find((marker) => marker.slug === 'fitz-roy')!.visible).toBe(false);
		expect(torreNamed(markers)).toBe(true);
	});

	it('caps the labels named in one view', async () => {
		const { markers, camera, viewChanged } = setup();
		const crowd: AtlasMarker[] = Array.from({ length: LABEL_DECLUTTER.maxLabels + 20 }, (_, i) => ({
			slug: `peak-${i}`,
			name: 'P',
			latitude: 45 + Math.floor(i / 10) * 0.6,
			longitude: 6 + (i % 10) * 0.9,
			elevationMeters: 3000 + i
		}));
		markers.set(crowd);
		await attached();

		lookDown(camera, 47, 10, 900_000);
		viewChanged();

		const named = markers.read()!.markers.filter((marker) => marker.labelShown);
		expect(named.length).toBeLessThanOrEqual(LABEL_DECLUTTER.maxLabels);
		expect(markers.targets.length).toBeGreaterThan(LABEL_DECLUTTER.maxLabels);
	});
});

const MATTERHORN: AtlasMarker = {
	slug: 'matterhorn',
	name: 'Matterhorn',
	latitude: 45.9763,
	longitude: 7.6586,
	elevationMeters: 4478
};

describe('AtlasMarkers emphasis', () => {
	const imageOf = (entity: cesium.Entity | undefined) =>
		entity!.billboard!.image!.getValue(NOW) as string;

	it('swaps one marker to the emphasized dot and returns the previous one to rest', async () => {
		const { markers, entity } = setup();
		markers.set([OLYMPUS, MONT_BLANC]);
		await attached();

		markers.emphasize(OLYMPUS.slug);
		expect(imageOf(entity(OLYMPUS.slug))).toBe('dot:emphasized@1');
		expect(imageOf(entity(MONT_BLANC.slug))).toBe('dot:rest@1');
		expect(markers.read()!.hovered).toBe(OLYMPUS.slug);

		markers.emphasize(MONT_BLANC.slug);
		expect(imageOf(entity(OLYMPUS.slug))).toBe('dot:rest@1');
		expect(imageOf(entity(MONT_BLANC.slug))).toBe('dot:emphasized@1');

		markers.emphasize(undefined);
		expect(imageOf(entity(MONT_BLANC.slug))).toBe('dot:rest@1');
		expect(markers.read()!.hovered).toBeUndefined();
	});

	it('reuses the two dot images however many markers are emphasized', async () => {
		const { markers, sprites } = setup();
		markers.set([OLYMPUS, MONT_BLANC, MATTERHORN]);
		await attached();

		for (const marker of [OLYMPUS, MONT_BLANC, MATTERHORN, OLYMPUS]) {
			markers.emphasize(marker.slug);
		}

		const images = new Set(sprites.dot.mock.results.map((result) => result.value.image));
		expect(images).toEqual(new Set(['dot:rest@1', 'dot:emphasized@1']));
	});

	it('keeps the place of the emphasized marker and creates no entity for it', async () => {
		const { markers, entity, layer } = setup();
		markers.set([OLYMPUS]);
		await attached();
		const before = entity(OLYMPUS.slug)!.position!.getValue(NOW);

		markers.emphasize(OLYMPUS.slug);
		await attached();

		expect(entity(OLYMPUS.slug)!.position!.getValue(NOW)).toEqual(before);
		expect(entity(OLYMPUS.slug)!.billboard!.heightReference!.getValue(NOW)).toBe(
			cesium.HeightReference.NONE
		);
		expect(markers.read()).toMatchObject({ entities: 1 });
		expect(layer()!.entities.values.filter((e) => e.id !== 'atlas-preview')).toHaveLength(1);
	});

	it('drops the emphasis when the layer is hidden', async () => {
		const { markers, entity } = setup();
		markers.set([OLYMPUS]);
		await attached();
		markers.emphasize(OLYMPUS.slug);
		markers.highlight(OLYMPUS.slug);

		markers.set(undefined);

		expect(markers.read()).toMatchObject({ shown: false });
		expect(markers.read()!.hovered).toBeUndefined();
		expect(markers.read()!.highlighted).toBeUndefined();
		expect(imageOf(entity(OLYMPUS.slug))).toBe('dot:rest@1');
		expect(entity('atlas-preview')!.show).toBe(false);
	});

	it('ignores a slug it does not draw', async () => {
		const { markers } = setup();
		markers.set([OLYMPUS]);
		await attached();

		markers.emphasize('unknown');
		markers.highlight('unknown');

		expect(markers.read()!.hovered).toBeUndefined();
		expect(markers.read()!.highlighted).toBeUndefined();
	});

	it('forgets an emphasized marker that leaves the catalog', async () => {
		const { markers, entity } = setup();
		markers.set([OLYMPUS, MONT_BLANC]);
		await attached();
		markers.highlight(OLYMPUS.slug);
		await attached();

		markers.set([MONT_BLANC]);

		expect(markers.read()!.highlighted).toBeUndefined();
		expect(entity('atlas-preview')!.show).toBe(false);
	});
});

describe('AtlasMarkers list highlight', () => {
	const imageOf = (entity: cesium.Entity | undefined) =>
		entity!.billboard!.image!.getValue(NOW) as string;

	it('emphasizes a marker the way the pointer does, and clears it', async () => {
		const { markers, entity } = setup();
		markers.set([OLYMPUS, MONT_BLANC]);
		await attached();

		markers.highlight(MONT_BLANC.slug);
		expect(imageOf(entity(MONT_BLANC.slug))).toBe('dot:emphasized@1');
		expect(markers.read()).toMatchObject({ highlighted: MONT_BLANC.slug });

		markers.highlight(OLYMPUS.slug);
		expect(imageOf(entity(MONT_BLANC.slug))).toBe('dot:rest@1');
		expect(imageOf(entity(OLYMPUS.slug))).toBe('dot:emphasized@1');

		markers.highlight(undefined);
		expect(imageOf(entity(OLYMPUS.slug))).toBe('dot:rest@1');
	});

	it('is not cleared by the picker, which clears its own pointer emphasis after every pass', async () => {
		const { markers, entity, viewChanged } = setup();
		markers.set([OLYMPUS, MONT_BLANC]);
		await attached();
		markers.highlight(MONT_BLANC.slug);

		markers.emphasize(undefined);
		viewChanged();

		expect(imageOf(entity(MONT_BLANC.slug))).toBe('dot:emphasized@1');
		expect(markers.read()).toMatchObject({ highlighted: MONT_BLANC.slug });
	});

	it('yields to the pointer while it rests on a marker, then returns to the row', async () => {
		const { markers, entity } = setup();
		markers.set([OLYMPUS, MONT_BLANC]);
		await attached();
		markers.highlight(MONT_BLANC.slug);

		markers.emphasize(OLYMPUS.slug);
		expect(imageOf(entity(OLYMPUS.slug))).toBe('dot:emphasized@1');
		expect(imageOf(entity(MONT_BLANC.slug))).toBe('dot:rest@1');

		markers.emphasize(undefined);
		expect(imageOf(entity(MONT_BLANC.slug))).toBe('dot:emphasized@1');
		expect(imageOf(entity(OLYMPUS.slug))).toBe('dot:rest@1');
	});

	it('never moves the camera, and shows nothing for a marker on the far side of the globe', async () => {
		const { markers, camera, viewChanged, entity } = setup();
		markers.set([OLYMPUS, ACONCAGUA]);
		await attached();
		const before = { ...camera.positionWC };

		markers.highlight(ACONCAGUA.slug);
		await attached();

		expect({ ...camera.positionWC }).toEqual(before);
		expect(markers.read()!.highlighted).toBe(ACONCAGUA.slug);
		expect(markers.read()!.preview).toBeUndefined();
		expect(entity(ACONCAGUA.slug)!.show).toBe(false);
		expect(entity('atlas-preview')!.show).toBe(false);

		lookDown(camera, ACONCAGUA.latitude, ACONCAGUA.longitude, 11_000_000);
		viewChanged();

		expect(markers.read()!.preview?.slug).toBe(ACONCAGUA.slug);
	});
});

describe('AtlasMarkers preview', () => {
	const previewEntity = (entity: (slug: string) => cesium.Entity | undefined) =>
		entity('atlas-preview')!;

	it('names the emphasized marker with the summit pill, above its dot and inside the canvas', async () => {
		const { markers, entity, sprites } = setup();
		markers.set([OLYMPUS]);
		await attached();

		markers.emphasize(OLYMPUS.slug);
		await attached();

		const reading = markers.read()!;
		const at = reading.markers[0]!.window!;
		const { box } = reading.preview!;
		expect(sprites.pill).toHaveBeenCalledWith('Mount Olympus', '2,918 m', 1, expect.any(Number));
		expect(box.right - box.left).toBeCloseTo(
			PILL_WIDTH - 2 * SUMMIT_MARKER_STYLE.pill.shadow.blur,
			5
		);
		expect(box.bottom - box.top).toBeCloseTo(SUMMIT_MARKER_STYLE.pill.height, 5);
		expect(box.bottom).toBeLessThan(at.y);
		expect((box.left + box.right) / 2).toBeCloseTo(at.x, 5);
		expect(box.left).toBeGreaterThanOrEqual(0);
		expect(box.top).toBeGreaterThanOrEqual(0);

		const pill = previewEntity(entity);
		expect(pill.show).toBe(true);
		expect(pill.billboard!.image!.getValue(NOW)).toBe('pill:Mount Olympus');
		expect(pill.billboard!.disableDepthTestDistance!.getValue(NOW)).toBe(Number.POSITIVE_INFINITY);
		const offset = pill.billboard!.pixelOffset!.getValue(NOW) as cesium.Cartesian2;
		expect(offset.y).toBeCloseTo(box.bottom - at.y + PILL_INSET, 5);
	});

	it('shows at any distance, though ordinary labels do not show from here', async () => {
		const { markers } = setup();
		markers.set([OLYMPUS]);
		await attached();

		markers.emphasize(OLYMPUS.slug);
		await attached();

		const [reading] = markers.read()!.markers;
		expect(reading!.distanceMeters).toBeGreaterThan(ATLAS_MARKER_STYLE.labelMaxMeters);
		expect(reading!.labelShown).toBe(false);
		expect(markers.read()!.preview?.slug).toBe(OLYMPUS.slug);
	});

	it('goes with the emphasis, keeping one entity for every preview', async () => {
		const { markers, layer, entity } = setup();
		markers.set([OLYMPUS, MONT_BLANC]);
		await attached();

		for (const slug of [OLYMPUS.slug, MONT_BLANC.slug, OLYMPUS.slug]) {
			markers.emphasize(slug);
			await attached();
			expect(markers.read()!.preview?.slug).toBe(slug);
		}
		markers.emphasize(undefined);

		expect(markers.read()!.preview).toBeUndefined();
		expect(previewEntity(entity).show).toBe(false);
		expect(layer()!.entities.values.filter((e) => e.id === 'atlas-preview')).toHaveLength(1);
		expect(layer()!.entities.values).toHaveLength(3);
	});

	it('drops a pill that finishes drawing after another marker was asked for', async () => {
		const { markers, entity, sprites } = setup();
		markers.set([OLYMPUS, MONT_BLANC]);
		await attached();
		sprites.holdPills();

		markers.emphasize(OLYMPUS.slug);
		markers.emphasize(MONT_BLANC.slug);
		sprites.releasePills();
		await attached();

		expect(markers.read()!.preview?.slug).toBe(MONT_BLANC.slug);
		expect(previewEntity(entity).billboard!.image!.getValue(NOW)).toBe('pill:Mont Blanc');
	});

	it('shows nothing, and does not fail, when the pill cannot be drawn', async () => {
		const { markers, sprites } = setup();
		markers.set([OLYMPUS]);
		await attached();
		sprites.pill.mockRejectedValueOnce(new Error('no 2d context'));

		markers.emphasize(OLYMPUS.slug);
		await attached();

		expect(markers.read()!.preview).toBeUndefined();
		expect(markers.read()!.hovered).toBe(OLYMPUS.slug);
	});

	it('slides inside the canvas and clear of the control columns beside the edge', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set([MONT_BLANC]);
		await attached();
		lookDown(camera, MONT_BLANC.latitude, MONT_BLANC.longitude + 8.4, 900_000);
		viewChanged();
		const at = markers.read()!.markers[0]!.window!;
		expect(at.x).toBeLessThan(40);

		markers.emphasize(MONT_BLANC.slug);
		await attached();

		const { box } = markers.read()!.preview!;
		expect(box.left).toBeGreaterThanOrEqual(CONTROL_GUTTER_REM * 16);
		expect(box.right).toBeLessThanOrEqual(800);
	});

	it('names the marker once: its ordinary label gives way, and no other label overlaps the pill', async () => {
		const { markers, camera, viewChanged } = setup();
		markers.set([MONT_BLANC, MATTERHORN]);
		await attached();
		lookDown(camera, 46, 7.2, 900_000);
		viewChanged();
		const named = (slug: string) =>
			markers.read()!.markers.find((reading) => reading.slug === slug)!;
		expect(named(MONT_BLANC.slug).labelShown).toBe(true);

		markers.emphasize(MONT_BLANC.slug);
		await attached();

		const { box } = markers.read()!.preview!;
		expect(named(MONT_BLANC.slug).labelShown).toBe(false);
		for (const reading of markers.read()!.markers) {
			if (reading.label) {
				expect(boxesOverlap(reading.label, box), `${reading.slug} label`).toBe(false);
			}
		}
		expect(named(MATTERHORN.slug).visible).toBe(true);
	});

	it('leaves no listener, entity or timer behind after release', async () => {
		const { markers, viewer, listeners } = setup();
		markers.set([OLYMPUS]);
		await attached();
		markers.emphasize(OLYMPUS.slug);
		await attached();

		markers.release();
		await attached();

		expect(listeners.size).toBe(0);
		expect(viewer.dataSources.length).toBe(0);
		expect(() => markers.highlight(OLYMPUS.slug)).not.toThrow();
	});
});
