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
import { formatElevation } from '../../../formatElevation';
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '../../../units/unitSystem';
import {
	ATLAS_MARKER_STYLE,
	diffMarkers,
	isMarkerVisible,
	labelOpacityStep,
	markerPresentation,
	placePreview,
	type AtlasLayerReading,
	type AtlasMarker,
	type ScreenBox
} from '../atlasMarkers';
import {
	LABEL_DECLUTTER,
	declutterLabels,
	labelBox,
	type LabelCandidate,
	type LabelSize
} from '../labelDeclutter';
import {
	CONTROL_GUTTER_REM,
	MARKER_LABEL_PLATE,
	pillFootprint,
	renderRatio,
	rootFontPixels,
	summitPillMaxContentWidth,
	type AtlasSpriteSource,
	type SummitSprite
} from '../marker';
import type { HitTarget } from '../markerHits';
import type { CesiumModule } from './CesiumModule';

export const ATLAS_LAYER_NAME = 'atlas';
const PREVIEW_ID = 'atlas-preview';

export interface AtlasMarkersOptions {
	/** Calls back whenever the view may have changed: the camera moved, turned or was resized. */
	listen(onChange: () => void): () => void;
	/** Canvas position of a world point in CSS pixels from the top left, if it projects at all. */
	project(position: Cartesian3, result: Cartesian2): Cartesian2 | undefined;
	/** The size of a label's text in CSS pixels, set in `font`, as Cesium will draw it. */
	measureText(text: string, font: string): LabelSize;
	/** The dot and the pill the atlas draws with. */
	sprites: AtlasSpriteSource;
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
	/** How opaque the label would be at the camera's distance, before it is rounded to a step. */
	labelAlpha: number;
	/** The opacity last handed to Cesium for this label. */
	labelOpacity: number;
	labelShown: boolean;
	labelBox: ScreenBox | undefined;
	text: LabelSize | undefined;
	/** What the picker reads; its position and label follow the last visibility pass. */
	target: HitTarget;
}

/** The one preview pill: its entity is made when first needed and kept, with the layer. */
interface Preview {
	entity: Entity;
	/** Bumped whenever the pill wanted changes, so a pill drawn late for an old one is dropped. */
	generation: number;
	sprite: SummitSprite | undefined;
	box: ScreenBox | undefined;
	/** The offset last handed to Cesium, so a pill that has not moved costs nothing. */
	offset: { x: number; y: number } | undefined;
}

interface SharedStyle {
	outline: Color;
	text: Color;
	plate: Color;
	platePadding: Cartesian2;
	pointScale: NearFarScalar;
	pointFade: NearFarScalar;
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
	/** The marker the mouse rests on, and the one a list row asks for; the mouse comes first. */
	private hovered: string | undefined;
	private highlighted: string | undefined;
	/** The marker drawn emphasized now, with its preview. */
	private emphasized: string | undefined;
	private preview: Preview | undefined;
	private units: UnitSystem = DEFAULT_UNIT_SYSTEM;
	private refreshing = false;
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

	/**
	 * Emphasizes the marker under the mouse, or with `undefined` none: its dot grows and a pill names
	 * it. Restyles at most two entities and prepares one pill.
	 */
	emphasize(slug: string | undefined): void {
		this.hovered = this.known(slug);
		this.restyle();
	}

	/**
	 * Emphasizes the marker of a list row the same way, for as long as the mouse is not on a marker
	 * of its own. A marker out of sight is not drawn, so nothing shows for it, and the camera never
	 * moves to find it.
	 */
	highlight(slug: string | undefined): void {
		this.highlighted = this.known(slug);
		this.restyle();
	}

	/**
	 * The unit the preview pill words its elevation in. A pill already on screen is redrawn in
	 * place: it stays until the new one is ready, and no entity, marker or hit target changes.
	 */
	setUnitSystem(system: UnitSystem): void {
		if (this.released || system === this.units) {
			return;
		}
		this.units = system;

		const preview = this.preview;
		const entry = this.emphasized === undefined ? undefined : this.entries.get(this.emphasized);
		if (!preview || !entry || this.viewer.isDestroyed()) {
			return;
		}
		preview.generation += 1;
		this.requestPill(preview, entry);
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
				...(labelShown && entry.labelBox
					? { label: { ...entry.labelBox }, labelOpacity: entry.labelOpacity }
					: {})
			};
		});

		return {
			shown: this.shown,
			...(this.hovered ? { hovered: this.hovered } : {}),
			...(this.highlighted ? { highlighted: this.highlighted } : {}),
			...(this.emphasized && this.preview?.box
				? { preview: { slug: this.emphasized, box: { ...this.preview.box } } }
				: {}),
			layers: this.attachedLayers(),
			entities: this.entries.size,
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
		this.preview = undefined;
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
		this.hovered = undefined;
		this.highlighted = undefined;
		this.restyle();
		if (this.layer) {
			this.layer.show = false;
		}
		stopListening?.();
		this.options.refreshed?.();
	}

	private known(slug: string | undefined): string | undefined {
		return slug !== undefined && this.entries.has(slug) ? slug : undefined;
	}

	// Brings what is drawn emphasized in line with who is asking: the mouse, else a list row.
	private restyle(): void {
		const next = this.hovered ?? this.highlighted;
		if (next === this.emphasized) {
			return;
		}
		this.setDot(this.emphasized, 'rest');
		this.setDot(next, 'emphasized');
		this.emphasized = next;
		this.prepare(next);
		if (this.shown && !this.refreshing) {
			this.refresh();
		}
	}

	private setDot(slug: string | undefined, state: 'rest' | 'emphasized'): void {
		const billboard = slug === undefined ? undefined : this.entries.get(slug)?.entity.billboard;
		if (billboard) {
			const sprite = this.options.sprites.dot(state, renderRatio(this.viewer.scene.canvas));
			billboard.image = new this.cesium.ConstantProperty(sprite.image);
			billboard.width = new this.cesium.ConstantProperty(sprite.width);
			billboard.height = new this.cesium.ConstantProperty(sprite.height);
		}
	}

	// The pill for `slug`, drawn once and cached by the sprites, so a pointer sweeping the globe
	// costs a texture per distinct mountain at most. The pill appears on the next pass after its
	// faces are ready, and only if the same marker is still the one asked for.
	private prepare(slug: string | undefined): void {
		const preview = slug === undefined ? this.preview : this.previewOf();
		if (!preview) {
			return;
		}
		preview.generation += 1;
		preview.sprite = undefined;
		preview.box = undefined;
		preview.offset = undefined;
		preview.entity.show = false;

		const entry = slug === undefined ? undefined : this.entries.get(slug);
		if (!entry) {
			return;
		}
		preview.entity.position = new this.cesium.ConstantPositionProperty(entry.position);
		this.requestPill(preview, entry);
	}

	// Asks for the pill of `entry` in the current unit and lands it only while `preview.generation`
	// is still the one asked under.
	private requestPill(preview: Preview, entry: MarkerEntry): void {
		const generation = preview.generation;
		const { canvas } = this.viewer.scene;
		const ratio = renderRatio(canvas);
		const maxContentWidth = summitPillMaxContentWidth(canvas.clientWidth, rootFontPixels());

		this.options.sprites
			.pill(
				entry.marker.name,
				formatElevation(entry.marker.elevationMeters, this.units),
				ratio,
				maxContentWidth
			)
			.then(
				(sprite) => {
					if (generation !== preview.generation || this.released || this.viewer.isDestroyed()) {
						return;
					}
					preview.sprite = sprite;
					const { billboard } = preview.entity;
					if (billboard) {
						billboard.image = new this.cesium.ConstantProperty(sprite.image);
						billboard.width = new this.cesium.ConstantProperty(sprite.width);
						billboard.height = new this.cesium.ConstantProperty(sprite.height);
					}
					if (this.shown && !this.refreshing) {
						this.refresh();
					}
				},
				() => {
					// The list names every mountain in text, so a pill that cannot be drawn leaves the
					// emphasized dot alone rather than fail the layer.
				}
			);
	}

	private previewOf(): Preview | undefined {
		if (this.preview) {
			return this.preview;
		}
		const layer = this.layer;
		if (!layer) {
			return undefined;
		}
		const { Cartesian2, HeightReference, VerticalOrigin } = this.cesium;
		const entity = layer.entities.add({
			id: PREVIEW_ID,
			show: false,
			billboard: {
				verticalOrigin: VerticalOrigin.BOTTOM,
				pixelOffset: new Cartesian2(),
				heightReference: HeightReference.NONE,
				// A name the reader asked for is never cut by terrain in front of its marker, which the
				// visibility pass has already shown to be above the horizon and in front of the camera.
				disableDepthTestDistance: Number.POSITIVE_INFINITY
			}
		});
		this.preview = { entity, generation: 0, sprite: undefined, box: undefined, offset: undefined };

		return this.preview;
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
			if (removed.length > 0) {
				this.hovered = this.known(this.hovered);
				this.highlighted = this.known(this.highlighted);
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
		if (removed.length > 0) {
			this.restyle();
		}
	}

	private create(layer: CustomDataSource, marker: AtlasMarker): MarkerEntry {
		const { HeightReference, LabelStyle, VerticalOrigin } = this.cesium;
		const style = ATLAS_MARKER_STYLE;
		const position = this.positionOf(marker);
		const dot = this.options.sprites.dot('rest', renderRatio(this.viewer.scene.canvas));

		const entity = layer.entities.add({
			id: marker.slug,
			name: marker.name,
			position,
			// Hidden until the first visibility pass, which runs before the next frame is drawn.
			show: false,
			billboard: {
				image: dot.image,
				width: dot.width,
				height: dot.height,
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
				translucencyByDistance: this.opacityOf(1),
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
			labelAlpha: 1,
			labelOpacity: 1,
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

	// A near/far pair holding one value at every distance, so the label is drawn at the opacity the
	// pass chose for it: Cesium evaluates the pair on the GPU, and only the label's own pair changes,
	// not its glyphs.
	private opacityOf(opacity: number): NearFarScalar {
		return new this.cesium.NearFarScalar(0, opacity, ATLAS_MARKER_STYLE.labelMaxMeters, opacity);
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
		this.refreshing = true;
		try {
			// The listener may move the emphasis, which changes what the pass draws, so it gets a bounded
			// number of settling passes instead of a re-entrant refresh.
			for (let pass = 0; pass < MAX_SETTLING_PASSES; pass += 1) {
				this.drawPass();
				const emphasized = this.emphasized;
				this.options.refreshed?.();
				if (this.emphasized === emphasized || !this.shown || this.viewer.isDestroyed()) {
					break;
				}
			}
		} finally {
			this.refreshing = false;
		}
	}

	private drawPass(): void {
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
			const {
				labelShown: inRange,
				labelFading,
				labelAlpha
			} = markerPresentation(Cartesian3.magnitude(toMarker));
			// The preview names the emphasized marker, so its ordinary label would only repeat it.
			if (!inRange) {
				continue;
			}
			entry.labelBox = labelBox({
				x: window.x,
				y: window.y,
				text: this.textOf(entry),
				offsetPixels: ATLAS_MARKER_STYLE.labelOffsetPixels
			});
			if (entry.marker.slug === this.emphasized) {
				continue;
			}
			entry.labelInRange = true;
			entry.labelAlpha = labelAlpha;
			labels.push({
				slug: entry.marker.slug,
				elevationMeters: entry.marker.elevationMeters,
				box: entry.labelBox,
				fading: labelFading,
				shown: entry.labelShown
			});
		}

		const preview = this.placePreview();
		this.applyLabels(
			labels.length > 0
				? declutterLabels(labels, LABEL_DECLUTTER, preview ? [preview] : NO_BOXES)
				: NO_LABELS
		);
	}

	// Where the emphasized marker's pill stands this pass, if it is drawn: beside the dot, clear of
	// the controls and the stage's edges. It is the first thing the labels make room for.
	private placePreview(): ScreenBox | undefined {
		const preview = this.preview;
		const entry = this.emphasized === undefined ? undefined : this.entries.get(this.emphasized);
		const sprite = preview?.sprite;
		const billboard = preview?.entity.billboard;
		if (!preview || !sprite || !billboard || !entry?.visible) {
			if (preview) {
				preview.box = undefined;
				preview.entity.show = false;
			}
			return undefined;
		}

		const { Cartesian3, Cartesian2, ConstantProperty } = this.cesium;
		const { canvas } = this.viewer.scene;
		const dot = ATLAS_MARKER_STYLE.dot;
		const distance = Cartesian3.distance(this.viewer.camera.positionWC, entry.position);
		const radius = (markerPresentation(distance).pointPixels / 2) * dot.emphasizedScale;
		const { box, offset } = placePreview(
			{ x: entry.target.x, y: entry.target.y },
			pillFootprint(sprite),
			radius,
			{
				bounds: { width: canvas.clientWidth, height: canvas.clientHeight },
				sideInsetPixels: CONTROL_GUTTER_REM * rootFontPixels()
			}
		);

		const y = offset.y + sprite.bottomInset;
		if (preview.offset?.x !== offset.x || preview.offset.y !== y) {
			preview.offset = { x: offset.x, y };
			billboard.pixelOffset = new ConstantProperty(new Cartesian2(offset.x, y));
		}
		preview.box = box;
		preview.entity.show = true;

		return box;
	}

	private applyLabels(shown: ReadonlySet<string>): void {
		const { ConstantProperty } = this.cesium;

		for (const entry of this.entries.values()) {
			const next = shown.has(entry.marker.slug);
			// The emphasized marker keeps the plate its label had, as a hit area only: pointing at the label
			// emphasized it, and losing that area would end the emphasis and bring the label back, forever.
			entry.target.label =
				next || entry.marker.slug === this.emphasized ? entry.labelBox : undefined;
			const label = entry.entity.label;
			if (!label) {
				continue;
			}
			// The opacity goes first, so a label coming back is never drawn once at its old value.
			const opacity = next ? labelOpacityStep(entry.labelAlpha) : entry.labelOpacity;
			if (opacity !== entry.labelOpacity) {
				entry.labelOpacity = opacity;
				label.translucencyByDistance = new ConstantProperty(this.opacityOf(opacity));
			}
			if (entry.labelShown !== next) {
				entry.labelShown = next;
				label.show = new ConstantProperty(next);
			}
		}
	}
}

const MAX_SETTLING_PASSES = 3;
const NO_LABELS: ReadonlySet<string> = new Set();
const NO_BOXES: readonly ScreenBox[] = [];

function targetOf({ slug, name, elevationMeters }: AtlasMarker): HitTarget {
	return { slug, name, elevationMeters, x: 0, y: 0, label: undefined };
}
