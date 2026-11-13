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
	type AtlasMarker,
	type ScreenBox
} from '../atlasMarkers';
import { declutterLabels, labelBox, type LabelCandidate, type LabelSize } from '../labelDeclutter';
import { MARKER_LABEL_PLATE } from '../marker';
import type { HitTarget } from '../markerHits';
import type { CesiumModule } from './CesiumModule';

export const ATLAS_LAYER_NAME = 'atlas';

export interface AtlasMarkersOptions {
	/** Calls back whenever the view may have changed: the camera moved, turned or was resized. */
	listen(onChange: () => void): () => void;
	/** Canvas position of a world point in CSS pixels from the top left, if it projects at all. */
	project(position: Cartesian3, result: Cartesian2): Cartesian2 | undefined;
	/** The size of a label's text in CSS pixels, set in `font`, as Cesium will draw it. */
	measureText(text: string, font: string): LabelSize;
	/** After every visibility pass, and when the layer is hidden: what can be hit has changed. */
	refreshed?(): void;
}

interface MarkerEntry {
	marker: AtlasMarker;
	entity: Entity;
	position: Cartesian3;
	visible: boolean;
	/** Within its label distance; whether the label shows is up to decluttering. */
	labelInRange: boolean;
	labelShown: boolean;
	labelBox: ScreenBox | undefined;
	text: LabelSize | undefined;
	/** What the picker reads; its position and label follow the last visibility pass. */
	target: HitTarget;
}

interface SharedStyle {
	point: Color;
	outline: Color;
	hoverOutline: Color;
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
 * The same pass declutters the labels and lists the markers on screen for hit testing, so a marker
 * can be pressed exactly where it is drawn, and only while it is drawn, named or not.
 */
export class AtlasMarkers {
	private layer: CustomDataSource | undefined;
	private attached: Promise<unknown> | undefined;
	private readonly entries = new Map<string, MarkerEntry>();
	private readonly visibleTargets: HitTarget[] = [];
	private readonly occluder: EllipsoidalOccluder;
	private readonly style: SharedStyle;
	private readonly toMarker: Cartesian3;
	private readonly window: Cartesian2;
	private stopListening: (() => void) | undefined;
	private emphasized: string | undefined;
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
			hoverOutline: Color.fromCssColorString(style.hoverOutlineColor),
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

	/** The markers on screen now, for hit testing; empty while the layer is hidden. */
	get targets(): readonly HitTarget[] {
		return this.visibleTargets;
	}

	/** Rings the marker under the mouse, or with `undefined` none. Restyles at most two entities. */
	emphasize(slug: string | undefined): void {
		const next = slug !== undefined && this.entries.has(slug) ? slug : undefined;
		if (next === this.emphasized) {
			return;
		}
		this.setOutline(this.emphasized, this.style.outline);
		this.setOutline(next, this.style.hoverOutline);
		this.emphasized = next;
	}

	read(): AtlasLayerReading | undefined {
		if (this.viewer.isDestroyed()) {
			return undefined;
		}
		const { Cartesian3 } = this.cesium;
		const camera = this.viewer.camera.positionWC;

		const markers = [...this.entries.values()].map((entry) => {
			const visible = this.shown && entry.visible;
			const labelShown = visible && entry.labelShown;
			const distanceMeters = Cartesian3.distance(camera, entry.position);
			const { pointPixels } = markerPresentation(distanceMeters);

			return {
				slug: entry.marker.slug,
				visible,
				...(visible ? { window: { x: entry.target.x, y: entry.target.y } } : {}),
				distanceMeters,
				pointPixels,
				labelShown,
				labelSuppressed: visible && entry.labelInRange && !entry.labelShown,
				...(labelShown && entry.labelBox ? { label: { ...entry.labelBox } } : {})
			};
		});

		return {
			shown: this.shown,
			...(this.emphasized ? { hovered: this.emphasized } : {}),
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
		this.visibleTargets.length = 0;
		this.emphasize(undefined);
		if (this.layer) {
			this.layer.show = false;
		}
		stopListening?.();
		this.options.refreshed?.();
	}

	private setOutline(slug: string | undefined, color: Color): void {
		const point = slug === undefined ? undefined : this.entries.get(slug)?.entity.point;
		if (point) {
			point.outlineColor = new this.cesium.ConstantProperty(color);
		}
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
				if (slug === this.emphasized) {
					this.emphasized = undefined;
				}
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

		return {
			marker,
			entity,
			position,
			visible: false,
			labelInRange: false,
			labelShown: false,
			labelBox: undefined,
			text: undefined,
			target: targetOf(marker)
		};
	}

	private update(entry: MarkerEntry, marker: AtlasMarker): void {
		const { ConstantPositionProperty, ConstantProperty } = this.cesium;
		const position = this.positionOf(marker);

		if (entry.marker.name !== marker.name) {
			entry.text = undefined;
		}
		entry.marker = marker;
		entry.position = position;
		entry.target = { ...targetOf(marker), x: entry.target.x, y: entry.target.y };
		entry.entity.name = marker.name;
		entry.entity.position = new ConstantPositionProperty(position);
		if (entry.entity.label) {
			entry.entity.label.text = new ConstantProperty(marker.name);
		}
	}

	private positionOf({ latitude, longitude, elevationMeters }: AtlasMarker): Cartesian3 {
		return this.cesium.Cartesian3.fromDegrees(longitude, latitude, elevationMeters);
	}

	// Measured the first time the label could show, then kept: names rarely change.
	private textOf(entry: MarkerEntry): LabelSize {
		entry.text ??= this.options.measureText(entry.marker.name, ATLAS_MARKER_STYLE.labelFont);
		return entry.text;
	}

	// O(n) per changed view: a dot product, a distance and a horizon test per marker, and a
	// projection for the ones above the horizon; then decluttering over the labels in range,
	// O(m log m + m·k) for m in range and k kept. Entities are only shown or hidden, never rebuilt.
	//
	// A label is switched on only within its distance and once decluttering keeps it: the distance
	// condition alone hides it on the GPU, but Cesium still builds and updates every glyph of a
	// shown label, which on a software renderer costs more than all the points together.
	private refresh(): void {
		if (!this.shown || this.viewer.isDestroyed()) {
			return;
		}
		const { Cartesian3 } = this.cesium;
		const { camera, scene } = this.viewer;
		const viewport = { width: scene.canvas.clientWidth, height: scene.canvas.clientHeight };
		this.occluder.cameraPosition = camera.positionWC;
		this.visibleTargets.length = 0;
		const labels: LabelCandidate[] = [];

		for (const entry of this.entries.values()) {
			const toMarker = Cartesian3.subtract(entry.position, camera.positionWC, this.toMarker);
			const inFront = Cartesian3.dot(camera.directionWC, toMarker) > 0;
			const aboveHorizon = inFront && this.occluder.isPointVisible(entry.position);
			const window = aboveHorizon ? this.options.project(entry.position, this.window) : undefined;
			const visible = isMarkerVisible({ inFront, aboveHorizon, window }, viewport);

			entry.visible = visible;
			if (entry.entity.show !== visible) {
				entry.entity.show = visible;
			}
			entry.labelInRange = false;
			entry.labelBox = undefined;
			if (!visible || !window) {
				continue;
			}

			entry.target.x = window.x;
			entry.target.y = window.y;
			this.visibleTargets.push(entry.target);
			const { labelShown: inRange, labelFading } = markerPresentation(
				Cartesian3.magnitude(toMarker)
			);
			if (!inRange) {
				continue;
			}
			entry.labelInRange = true;
			entry.labelBox = labelBox({
				x: window.x,
				y: window.y,
				text: this.textOf(entry),
				offsetPixels: ATLAS_MARKER_STYLE.labelOffsetPixels
			});
			labels.push({
				slug: entry.marker.slug,
				elevationMeters: entry.marker.elevationMeters,
				box: entry.labelBox,
				fading: labelFading,
				shown: entry.labelShown
			});
		}

		this.applyLabels(labels.length > 0 ? declutterLabels(labels) : NO_LABELS);
		this.options.refreshed?.();
	}

	private applyLabels(shown: ReadonlySet<string>): void {
		const { ConstantProperty } = this.cesium;

		for (const entry of this.entries.values()) {
			const next = shown.has(entry.marker.slug);
			entry.target.label = next ? entry.labelBox : undefined;
			if (entry.labelShown !== next && entry.entity.label) {
				entry.labelShown = next;
				entry.entity.label.show = new ConstantProperty(next);
			}
		}
	}
}

const NO_LABELS: ReadonlySet<string> = new Set();

function targetOf({ slug, name, elevationMeters }: AtlasMarker): HitTarget {
	return { slug, name, elevationMeters, x: 0, y: 0, label: undefined };
}
