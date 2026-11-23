import type {
	Cartesian2,
	Cartesian3,
	DistanceDisplayCondition,
	HeightReference,
	Viewer
} from 'cesium';
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
 * The disc appears at once. The pill appears when its faces are ready, and only if the same
 * summit is still showing by then. On the phone layout the pill is left out, and drawn only if the
 * stage grows past that breakpoint while the summit is showing.
 */
export class SummitMarkers implements SummitMarkerDisplay {
	private readonly heightReference: HeightReference;
	private readonly distance: DistanceDisplayCondition;
	private generation = 0;
	private current: { marker: SummitMarker; position: Cartesian3 } | undefined;
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

		const { canvas } = this.viewer.scene;
		const position = this.cesium.Cartesian3.fromDegrees(
			marker.longitude,
			marker.latitude,
			marker.elevationMeters
		);

		this.viewer.entities.add({
			id: SUMMIT_MARKER_ID,
			position,
			billboard: {
				image: this.sprites.disc(renderRatio(canvas)).image,
				heightReference: this.heightReference,
				distanceDisplayCondition: this.distance
			}
		});

		this.current = { marker, position };
		this.compactStage.addEventListener('change', this.onLayoutChange);
		this.syncPill();
	}

	hide(): void {
		this.generation += 1;
		this.current = undefined;
		this.compactStage.removeEventListener('change', this.onLayoutChange);

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
		if (!this.current || this.compactStage.matches) {
			return;
		}

		const { marker, position } = this.current;
		const { canvas } = this.viewer.scene;
		const maxContentWidth = summitPillMaxContentWidth(
			canvas.clientWidth,
			rootFontPixels(),
			SUMMIT_MARKER_STYLE.pill.summitScale
		);

		void this.showPill(marker, position, renderRatio(canvas), maxContentWidth, this.generation);
	}

	private async showPill(
		{ name, elevation }: SummitMarker,
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
