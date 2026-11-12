import type {
	Cartesian2,
	Cartesian3,
	Color,
	CustomDataSource,
	DistanceDisplayCondition,
	EllipsoidalOccluder,
	Entity,
	NearFarScalar,
	Viewer
} from 'cesium';
import {
	ATLAS_MARKER_STYLE,
	diffMarkers,
	isMarkerVisible,
	markerPresentation,
	type AtlasLayerReading,
	type AtlasMarker
} from '../atlasMarkers';
import { MARKER_LABEL_PLATE } from '../marker';
import type { CesiumModule } from './CesiumModule';

export const ATLAS_LAYER_NAME = 'atlas';

export interface AtlasMarkersOptions {
	/** Calls back whenever the view may have changed: the camera moved, turned or was resized. */
	listen(onChange: () => void): () => void;
	/** Canvas position of a world point in CSS pixels from the top left, if it projects at all. */
	project(position: Cartesian3, result: Cartesian2): Cartesian2 | undefined;
}

interface MarkerEntry {
	marker: AtlasMarker;
	entity: Entity;
	position: Cartesian3;
	visible: boolean;
	labelled: boolean;
	x: number;
	y: number;
}

interface SharedStyle {
	point: Color;
	outline: Color;
	text: Color;
	plate: Color;
	platePadding: Cartesian2;
	pointScale: NearFarScalar;
	pointFade: NearFarScalar;
	labelFade: NearFarScalar;
	labelDistance: DistanceDisplayCondition;
	labelOffset: Cartesian2;
}

/**
 * The atlas's mountains on the globe, in a data source of their own beside the Viewer's entities,
 * where the summit marker lives. Markers stand at their catalog elevation, never clamped, so where
 * one is drawn is exactly where it projects, and a marker shows only while it is in front of the
 * camera, above the horizon and inside the canvas. That decision is made here in one pass whenever
 * the view changes; the depth settings of the scene are left as Cesium has them.
 *
 * The layer draws and nothing else: it has no input handlers, selection or focus.
 */
export class AtlasMarkers {
	private layer: CustomDataSource | undefined;
	private attached: Promise<unknown> | undefined;
	private readonly entries = new Map<string, MarkerEntry>();
	private readonly occluder: EllipsoidalOccluder;
	private readonly style: SharedStyle;
	private readonly toMarker: Cartesian3;
	private readonly window: Cartesian2;
	private stopListening: (() => void) | undefined;
	private shown = false;
	private released = false;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer,
		private readonly options: AtlasMarkersOptions
	) {
		const { Cartesian2, Cartesian3, Color, DistanceDisplayCondition, NearFarScalar } = cesium;
		const style = ATLAS_MARKER_STYLE;

		this.occluder = new cesium.EllipsoidalOccluder(viewer.scene.globe.ellipsoid);
		this.toMarker = new Cartesian3();
		this.window = new Cartesian2();
		this.style = {
			point: Color.fromCssColorString(style.pointColor),
			outline: Color.fromCssColorString(style.outlineColor).withAlpha(style.outlineAlpha),
			text: Color.fromCssColorString(style.labelColor),
			plate: Color.fromCssColorString(MARKER_LABEL_PLATE.color).withAlpha(MARKER_LABEL_PLATE.alpha),
			platePadding: new Cartesian2(
				MARKER_LABEL_PLATE.paddingPixels.x,
				MARKER_LABEL_PLATE.paddingPixels.y
			),
			pointScale: new NearFarScalar(
				style.pointNearMeters,
				1,
				style.pointFarMeters,
				style.pointFarScale
			),
			pointFade: new NearFarScalar(
				style.pointOpaqueMeters,
				1,
				style.pointFadedMeters,
				style.pointFarAlpha
			),
			labelFade: new NearFarScalar(style.labelFullMeters, 1, style.labelMaxMeters, 0),
			labelDistance: new DistanceDisplayCondition(0, style.labelMaxMeters),
			labelOffset: new Cartesian2(0, -style.labelOffsetPixels)
		};
	}

	/**
	 * Shows these markers, reconciled by slug with the ones shown before, so an unchanged mountain
	 * keeps its entity. `undefined` hides the layer and stops following the camera; the entities are
	 * kept for a return to the atlas.
	 */
	set(markers: readonly AtlasMarker[] | undefined): void {
		if (this.released || this.viewer.isDestroyed()) {
			return;
		}
		if (!markers) {
			this.hide();
			return;
		}

		const layer = this.attachLayer();
		this.reconcile(layer, markers);
		this.shown = true;
		layer.show = true;
		this.stopListening ??= this.options.listen(() => this.refresh());
		this.refresh();
	}

	read(): AtlasLayerReading | undefined {
		if (this.viewer.isDestroyed()) {
			return undefined;
		}
		const { Cartesian3 } = this.cesium;
		const camera = this.viewer.camera.positionWC;

		const markers = [...this.entries.values()].map((entry) => {
			const visible = this.shown && entry.visible;
			const distanceMeters = Cartesian3.distance(camera, entry.position);
			const { pointPixels } = markerPresentation(distanceMeters);

			return {
				slug: entry.marker.slug,
				visible,
				...(visible ? { window: { x: entry.x, y: entry.y } } : {}),
				distanceMeters,
				pointPixels,
				labelShown: visible && entry.labelled
			};
		});

		return {
			shown: this.shown,
			layers: this.attachedLayers(),
			entities: this.layer?.entities.values.length ?? 0,
			depthTestAgainstTerrain: this.viewer.scene.globe.depthTestAgainstTerrain,
			markers
		};
	}

	/** Idempotent. Leaves no listener and no data source on the Viewer. */
	release(): void {
		if (this.released) {
			return;
		}
		this.released = true;
		this.hide();

		const layer = this.layer;
		const attached = this.attached;
		this.layer = undefined;
		this.attached = undefined;
		this.entries.clear();
		if (!layer || this.viewer.isDestroyed()) {
			return;
		}
		const detach = () => {
			if (!this.viewer.isDestroyed()) {
				this.viewer.dataSources.remove(layer, true);
			}
		};
		// The collection takes a data source a microtask after add(); removing it before then would
		// find nothing and leave it to be attached afterwards.
		if (this.viewer.dataSources.contains(layer)) {
			detach();
		} else {
			void attached?.then(detach);
		}
	}

	private hide(): void {
		const stopListening = this.stopListening;
		this.stopListening = undefined;
		this.shown = false;
		if (this.layer) {
			this.layer.show = false;
		}
		stopListening?.();
	}

	private attachLayer(): CustomDataSource {
		if (this.layer) {
			return this.layer;
		}
		const layer = new this.cesium.CustomDataSource(ATLAS_LAYER_NAME);
		// Taken by the collection a microtask later, before the next frame; entities and visibility
		// set meanwhile are drawn from that frame on.
		this.attached = this.viewer.dataSources.add(layer);
		this.layer = layer;

		return layer;
	}

	private attachedLayers(): number {
		const { dataSources } = this.viewer;
		let count = 0;
		for (let index = 0; index < dataSources.length; index += 1) {
			if (dataSources.get(index).name === ATLAS_LAYER_NAME) {
				count += 1;
			}
		}

		return count;
	}

	private reconcile(layer: CustomDataSource, markers: readonly AtlasMarker[]): void {
		const { added, changed, removed } = diffMarkers(
			[...this.entries.values()].map((entry) => entry.marker),
			markers
		);
		if (added.length + changed.length + removed.length === 0) {
			return;
		}

		const { entities } = layer;
		entities.suspendEvents();
		try {
			for (const slug of removed) {
				entities.removeById(slug);
				this.entries.delete(slug);
			}
			for (const marker of changed) {
				this.update(this.entries.get(marker.slug)!, marker);
			}
			for (const marker of added) {
				this.entries.set(marker.slug, this.create(layer, marker));
			}
		} finally {
			entities.resumeEvents();
		}
	}

	private create(layer: CustomDataSource, marker: AtlasMarker): MarkerEntry {
		const { HeightReference, LabelStyle, VerticalOrigin } = this.cesium;
		const style = ATLAS_MARKER_STYLE;
		const position = this.positionOf(marker);

		const entity = layer.entities.add({
			id: marker.slug,
			name: marker.name,
			position,
			// Hidden until the first visibility pass, which runs before the next frame is drawn.
			show: false,
			point: {
				pixelSize: style.pointPixelSize,
				color: this.style.point,
				outlineColor: this.style.outline,
				outlineWidth: style.pointOutlinePixels,
				scaleByDistance: this.style.pointScale,
				translucencyByDistance: this.style.pointFade,
				heightReference: HeightReference.NONE
			},
			label: {
				text: marker.name,
				font: style.labelFont,
				style: LabelStyle.FILL_AND_OUTLINE,
				fillColor: this.style.text,
				outlineColor: this.style.outline,
				outlineWidth: style.labelOutlinePixels,
				showBackground: true,
				backgroundColor: this.style.plate,
				backgroundPadding: this.style.platePadding,
				verticalOrigin: VerticalOrigin.BOTTOM,
				pixelOffset: this.style.labelOffset,
				translucencyByDistance: this.style.labelFade,
				distanceDisplayCondition: this.style.labelDistance,
				heightReference: HeightReference.NONE,
				show: false
			}
		});

		return { marker, entity, position, visible: false, labelled: false, x: 0, y: 0 };
	}

	private update(entry: MarkerEntry, marker: AtlasMarker): void {
		const { ConstantPositionProperty, ConstantProperty } = this.cesium;
		const position = this.positionOf(marker);

		entry.marker = marker;
		entry.position = position;
		entry.entity.name = marker.name;
		entry.entity.position = new ConstantPositionProperty(position);
		if (entry.entity.label) {
			entry.entity.label.text = new ConstantProperty(marker.name);
		}
	}

	private positionOf({ latitude, longitude, elevationMeters }: AtlasMarker): Cartesian3 {
		return this.cesium.Cartesian3.fromDegrees(longitude, latitude, elevationMeters);
	}

	// O(n) per changed view: a dot product, a distance and a horizon test per marker, and a
	// projection for the ones above the horizon. Entities are only shown or hidden, never rebuilt.
	//
	// A label is switched on only within its distance: the distance condition alone hides it on the
	// GPU, but Cesium still builds and updates every glyph of a shown label, which on a software
	// renderer costs more than all the points together.
	private refresh(): void {
		if (!this.shown || this.viewer.isDestroyed()) {
			return;
		}
		const { Cartesian3, ConstantProperty } = this.cesium;
		const { camera, scene } = this.viewer;
		const viewport = { width: scene.canvas.clientWidth, height: scene.canvas.clientHeight };
		this.occluder.cameraPosition = camera.positionWC;

		for (const entry of this.entries.values()) {
			const toMarker = Cartesian3.subtract(entry.position, camera.positionWC, this.toMarker);
			const inFront = Cartesian3.dot(camera.directionWC, toMarker) > 0;
			const aboveHorizon = inFront && this.occluder.isPointVisible(entry.position);
			const window = aboveHorizon ? this.options.project(entry.position, this.window) : undefined;
			const visible = isMarkerVisible({ inFront, aboveHorizon, window }, viewport);

			entry.visible = visible;
			if (visible && window) {
				entry.x = window.x;
				entry.y = window.y;
			}
			if (entry.entity.show !== visible) {
				entry.entity.show = visible;
			}

			const labelled = visible && markerPresentation(Cartesian3.magnitude(toMarker)).labelShown;
			if (entry.labelled !== labelled && entry.entity.label) {
				entry.labelled = labelled;
				entry.entity.label.show = new ConstantProperty(labelled);
			}
		}
	}
}
