import type { Cartesian2, Color, DistanceDisplayCondition, HeightReference, Viewer } from 'cesium';
import {
	MARKER_LABEL_PLATE,
	SUMMIT_MARKER_STYLE,
	type SummitMarker,
	type SummitMarkerDisplay
} from '../marker';
import type { CesiumModule } from './CesiumModule';

const SUMMIT_MARKER_ID = 'summit-marker';

export class SummitMarkers implements SummitMarkerDisplay {
	private readonly heightReference: HeightReference;
	private readonly distance: DistanceDisplayCondition;
	private readonly plate: Color;
	private readonly padding: Cartesian2;

	constructor(
		private readonly cesium: CesiumModule,
		private readonly viewer: Viewer
	) {
		this.heightReference = cesium.HeightReference.CLAMP_TO_TERRAIN;
		this.distance = new cesium.DistanceDisplayCondition(0, SUMMIT_MARKER_STYLE.maxDistanceMeters);
		this.plate = cesium.Color.fromCssColorString(MARKER_LABEL_PLATE.color).withAlpha(
			MARKER_LABEL_PLATE.alpha
		);
		this.padding = new cesium.Cartesian2(
			MARKER_LABEL_PLATE.paddingPixels.x,
			MARKER_LABEL_PLATE.paddingPixels.y
		);
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
				backgroundColor: this.plate,
				backgroundPadding: this.padding,
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
