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
	summitPillMaxContentWidth,
	type SummitMarker,
	type SummitMarkerDisplay,
	type SummitSpriteSource
} from '../marker';
import type { CesiumModule } from './CesiumModule';

const SUMMIT_MARKER_ID = 'summit-marker';
const SUMMIT_LABEL_ID = 'summit-label';

function rootFontPixels(): number {
	if (typeof document === 'undefined') {
		return 16;
	}

	return Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/**
 * The summit on stage: a disc at the summit and a pill naming it just above, both billboards
 * clamped to the terrain and faded out by distance exactly as the point and label they replace.
 * The depth test is left as it was, so a ridge in front still hides them.
 *
 * The disc appears at once. The pill appears when its faces are ready, and only if the same
 * summit is still showing by then.
 */
export class SummitMarkers implements SummitMarkerDisplay {
	private readonly heightReference: HeightReference;
	private readonly distance: DistanceDisplayCondition;
	private generation = 0;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer,
		private readonly sprites: SummitSpriteSource
	) {
		this.heightReference = cesium.HeightReference.CLAMP_TO_TERRAIN;
		this.distance = new cesium.DistanceDisplayCondition(0, SUMMIT_MARKER_STYLE.maxDistanceMeters);
	}

	show(marker: SummitMarker): void {
		this.hide();

		const generation = this.generation;
		const { canvas } = this.viewer.scene;
		const ratio = renderRatio(canvas);
		const maxContentWidth = summitPillMaxContentWidth(canvas.clientWidth, rootFontPixels());
		const position = this.cesium.Cartesian3.fromDegrees(
			marker.longitude,
			marker.latitude,
			marker.elevationMeters
		);

		this.viewer.entities.add({
			id: SUMMIT_MARKER_ID,
			position,
			billboard: {
				image: this.sprites.disc(ratio).image,
				heightReference: this.heightReference,
				distanceDisplayCondition: this.distance
			}
		});

		void this.showPill(marker, position, ratio, maxContentWidth, generation);
	}

	hide(): void {
		this.generation += 1;

		if (!this.viewer.isDestroyed()) {
			this.viewer.entities.removeById(SUMMIT_MARKER_ID);
			this.viewer.entities.removeById(SUMMIT_LABEL_ID);
		}
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
			sprite = await this.sprites.pill(name, elevation, ratio, maxContentWidth);
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
