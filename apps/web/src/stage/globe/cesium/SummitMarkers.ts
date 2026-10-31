import type { DistanceDisplayCondition, HeightReference, Viewer } from 'cesium';
import { SUMMIT_MARKER_STYLE, type SummitMarker, type SummitMarkerDisplay } from '../marker';
import type { CesiumModule } from './CesiumModule';

const SUMMIT_MARKER_ID = 'summit-marker';

export class SummitMarkers implements SummitMarkerDisplay {
	private readonly heightReference: HeightReference;
	private readonly distance: DistanceDisplayCondition;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer
	) {
		this.heightReference = cesium.HeightReference.CLAMP_TO_TERRAIN;
		this.distance = new cesium.DistanceDisplayCondition(0, SUMMIT_MARKER_STYLE.maxDistanceMeters);
	}

	show({ latitude, longitude, elevationMeters, label }: SummitMarker): void {
		const { Cartesian2, Cartesian3, Color, LabelStyle, VerticalOrigin } = this.cesium;

		this.hide();
		this.viewer.entities.add({
			id: SUMMIT_MARKER_ID,
			position: Cartesian3.fromDegrees(longitude, latitude, elevationMeters),
			point: {
				pixelSize: SUMMIT_MARKER_STYLE.pointPixelSize,
				color: Color.WHITE,
				outlineColor: Color.BLACK.withAlpha(0.7),
				outlineWidth: 2,
				heightReference: this.heightReference,
				distanceDisplayCondition: this.distance
			},
			label: {
				text: label,
				font: SUMMIT_MARKER_STYLE.labelFont,
				style: LabelStyle.FILL_AND_OUTLINE,
				fillColor: Color.WHITE,
				outlineColor: Color.BLACK,
				outlineWidth: 3,
				showBackground: true,
				backgroundColor: Color.BLACK.withAlpha(0.45),
				verticalOrigin: VerticalOrigin.BOTTOM,
				pixelOffset: new Cartesian2(0, -SUMMIT_MARKER_STYLE.labelOffsetPixels),
				heightReference: this.heightReference,
				distanceDisplayCondition: this.distance
			}
		});
	}

	hide(): void {
		if (!this.viewer.isDestroyed()) {
			this.viewer.entities.removeById(SUMMIT_MARKER_ID);
		}
	}
}
