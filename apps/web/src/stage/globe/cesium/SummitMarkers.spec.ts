import * as cesium from 'cesium';
import { describe, expect, it } from 'vitest';
import { MARKER_LABEL_PLATE } from '../marker';
import type { CesiumModule } from './CesiumModule';
import { SummitMarkers } from './SummitMarkers';

const NOW = cesium.JulianDate.now();

function setup() {
	const viewer = { entities: new cesium.EntityCollection(), isDestroyed: () => false };
	const markers = new SummitMarkers(cesium as unknown as CesiumModule, viewer as never);

	return { markers, viewer };
}

describe('SummitMarkers', () => {
	it('names the summit and its elevation on the same dark plate the atlas labels use', () => {
		const { markers, viewer } = setup();

		markers.show({
			latitude: 46,
			longitude: 7,
			elevationMeters: 4478,
			label: 'Matterhorn\n4,478 m'
		});

		const label = viewer.entities.getById('summit-marker')!.label!;
		const plate = label.backgroundColor!.getValue(NOW) as cesium.Color;
		expect(label.text!.getValue(NOW)).toBe('Matterhorn\n4,478 m');
		expect(label.showBackground!.getValue(NOW)).toBe(true);
		expect(plate.alpha).toBe(MARKER_LABEL_PLATE.alpha);
		expect(plate.alpha).toBeGreaterThan(0.45);
	});

	it('shows one summit at a time', () => {
		const { markers, viewer } = setup();
		const summit = { latitude: 46, longitude: 7, elevationMeters: 4478, label: 'A' };

		markers.show(summit);
		markers.show({ ...summit, label: 'B' });

		expect(viewer.entities.values).toHaveLength(1);
		markers.hide();
		expect(viewer.entities.values).toHaveLength(0);
	});
});
