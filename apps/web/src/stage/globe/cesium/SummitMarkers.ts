import type {
	Cartesian2,
	Cartesian3,
	DistanceDisplayCondition,
	HeightReference,
	Viewer
} from 'cesium';
import { formatElevation } from '../../../formatElevation';
import { DEFAULT_UNIT_SYSTEM, type UnitSystem } from '../../../units/unitSystem';
import {
	SUMMIT_MARKER_STYLE,
	renderRatio,
	rootFontPixels,
	summitPillMaxContentWidth,
	type SummitMarker,
	type SummitMarkerDisplay,
	type SummitSpriteSource
} from '../marker';
import type { CesiumModule } from './CesiumModule';

const SUMMIT_MARKER_ID = 'summit-marker';
const SUMMIT_LABEL_ID = 'summit-label';

/** The page's phone layout (the breakpoint in StageLayout.module.css): the masthead names the summit there. */
export const COMPACT_STAGE_QUERY = '(max-width: 55.99rem)';

export interface CompactStageQuery {
	readonly matches: boolean;
	addEventListener(type: 'change', listener: () => void): void;
	removeEventListener(type: 'change', listener: () => void): void;
}

/**
 * The summit on stage: a disc at the summit and a pill naming it just above, both billboards
 * clamped to the terrain and faded out by distance exactly as the point and label they replace.
 * The depth test is left as it was, so a ridge in front still hides them.
 *
 * The pill words the elevation in the unit system set on this display; changing it redraws the
 * pill in place, keeping the old one on stage until the new one is ready. The disc is untouched.
 *
 * The disc appears at once. The pill appears when its faces are ready, and only if the same
 * summit is still showing by then. On the phone layout the pill is left out, and drawn only if the
 * stage grows past that breakpoint while the summit is showing.
 *
 * The reader may hide the summit marker. Hiding takes the disc and the pill off the stage but keeps
 * the summit being presented, so showing it again, or a mountain presented while hidden, draws
 * the same disc and pill as if it had never been hidden. Nothing here touches the camera.
 */
export class SummitMarkers implements SummitMarkerDisplay {
	private readonly heightReference: HeightReference;
	private readonly distance: DistanceDisplayCondition;
	private generation = 0;
	private current: { marker: SummitMarker; position: Cartesian3 } | undefined;
	private units: UnitSystem = DEFAULT_UNIT_SYSTEM;
	private visible = true;
	private readonly onLayoutChange = () => this.syncPill();

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer,
		private readonly sprites: SummitSpriteSource,
		private readonly compactStage: CompactStageQuery
	) {
		this.heightReference = cesium.HeightReference.CLAMP_TO_TERRAIN;
		this.distance = new cesium.DistanceDisplayCondition(0, SUMMIT_MARKER_STYLE.maxDistanceMeters);
	}

	show(marker: SummitMarker): void {
		this.hide();

		const position = this.cesium.Cartesian3.fromDegrees(
			marker.longitude,
			marker.latitude,
			marker.elevationMeters
		);

		this.current = { marker, position };
		this.compactStage.addEventListener('change', this.onLayoutChange);
		this.drawDisc(position);
		this.syncPill();
	}

	/** Idempotent. Hidden, a summit is still presented; it is just not drawn. */
	setVisible(next: boolean): void {
		if (next === this.visible) {
			return;
		}
		this.visible = next;

		if (!this.current || this.viewer.isDestroyed()) {
			return;
		}
		if (next) {
			this.drawDisc(this.current.position);
			this.syncPill();
			return;
		}

		// A pill still being drawn must not land on a stage that has been cleared.
		this.generation += 1;
		this.removeEntities();
	}

	setUnitSystem(system: UnitSystem): void {
		if (system === this.units) {
			return;
		}
		this.units = system;

		if (this.drawsPill() && this.current && !this.viewer.isDestroyed()) {
			this.drawPill(this.current);
		}
	}

	hide(): void {
		this.generation += 1;
		this.current = undefined;
		this.compactStage.removeEventListener('change', this.onLayoutChange);

		this.removeEntities();
	}

	private drawsPill(): boolean {
		return this.visible && !this.compactStage.matches;
	}

	private drawDisc(position: Cartesian3): void {
		if (!this.visible || this.viewer.isDestroyed()) {
			return;
		}

		this.viewer.entities.add({
			id: SUMMIT_MARKER_ID,
			position,
			billboard: {
				image: this.sprites.disc(renderRatio(this.viewer.scene.canvas)).image,
				heightReference: this.heightReference,
				distanceDisplayCondition: this.distance
			}
		});
	}

	private removeEntities(): void {
		if (!this.viewer.isDestroyed()) {
			this.viewer.entities.removeById(SUMMIT_MARKER_ID);
			this.viewer.entities.removeById(SUMMIT_LABEL_ID);
		}
	}

	private syncPill(): void {
		this.generation += 1;
		if (this.viewer.isDestroyed()) {
			return;
		}

		this.viewer.entities.removeById(SUMMIT_LABEL_ID);
		if (!this.current || !this.drawsPill()) {
			return;
		}

		this.drawPill(this.current);
	}

	// Asks for the pill in the current unit; whichever request is newest is the only one that lands.
	private drawPill({ marker, position }: { marker: SummitMarker; position: Cartesian3 }): void {
		this.generation += 1;
		const { canvas } = this.viewer.scene;
		const maxContentWidth = summitPillMaxContentWidth(
			canvas.clientWidth,
			rootFontPixels(),
			SUMMIT_MARKER_STYLE.pill.summitScale
		);

		void this.showPill(
			marker.name,
			formatElevation(marker.elevationMeters, this.units),
			position,
			renderRatio(canvas),
			maxContentWidth,
			this.generation
		);
	}

	private async showPill(
		name: string,
		elevation: string,
		position: Cartesian3,
		ratio: number,
		maxContentWidth: number,
		generation: number
	): Promise<void> {
		let sprite;
		try {
			sprite = await this.sprites.pill(
				name,
				elevation,
				ratio,
				maxContentWidth,
				SUMMIT_MARKER_STYLE.pill.summitScale
			);
		} catch {
			// The page names the mountain in text, so the stage keeps the disc alone rather than fail.
			return;
		}
		if (generation !== this.generation || this.viewer.isDestroyed()) {
			return;
		}

		const { Cartesian2, VerticalOrigin } = this.cesium;
		const offset: Cartesian2 = new Cartesian2(
			0,
			sprite.bottomInset - SUMMIT_MARKER_STYLE.labelOffsetPixels
		);

		const shown = this.viewer.entities.getById(SUMMIT_LABEL_ID)?.billboard;
		if (shown) {
			shown.image = new this.cesium.ConstantProperty(sprite.image);
			shown.pixelOffset = new this.cesium.ConstantProperty(offset);
			return;
		}

		this.viewer.entities.add({
			id: SUMMIT_LABEL_ID,
			position,
			billboard: {
				image: sprite.image,
				verticalOrigin: VerticalOrigin.BOTTOM,
				pixelOffset: offset,
				heightReference: this.heightReference,
				distanceDisplayCondition: this.distance
			}
		});
	}
}
