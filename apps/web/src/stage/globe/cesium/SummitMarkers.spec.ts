import * as cesium from 'cesium';
import { describe, expect, it } from 'vitest';
import {
	SUMMIT_MARKER_STYLE,
	summitPillMaxContentWidth,
	type SummitSprite,
	type SummitSpriteSource
} from '../marker';
import type { CesiumModule } from './CesiumModule';
import { SummitMarkers } from './SummitMarkers';

const NOW = cesium.JulianDate.now();
const SUMMIT = {
	latitude: 46,
	longitude: 7,
	elevationMeters: 4478,
	name: 'Matterhorn',
	elevation: '4,478 m'
};

class FakeSprites implements SummitSpriteSource {
	readonly pillRequests: {
		name: string;
		elevation: string;
		ratio: number;
		maxContentWidth: number;
	}[] = [];
	private readonly waiting: { resolve(sprite: SummitSprite): void; reject(error: Error): void }[] =
		[];

	disc(ratio: number): SummitSprite {
		return { image: `disc@${ratio}`, width: 21, height: 21, bottomInset: 0 };
	}

	pill(
		name: string,
		elevation: string,
		ratio: number,
		maxContentWidth: number
	): Promise<SummitSprite> {
		this.pillRequests.push({ name, elevation, ratio, maxContentWidth });

		return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
	}

	finish(index = 0): void {
		this.waiting[index]!.resolve({
			image: `pill:${this.pillRequests[index]!.name}`,
			width: 180,
			height: 62,
			bottomInset: 14
		});
	}

	fail(index = 0): void {
		this.waiting[index]!.reject(new Error('no canvas'));
	}
}

function setup(canvas = { width: 1000, clientWidth: 1000 }) {
	const viewer = {
		entities: new cesium.EntityCollection(),
		scene: { canvas },
		destroyed: false,
		isDestroyed() {
			return this.destroyed;
		}
	};
	const sprites = new FakeSprites();
	const markers = new SummitMarkers(cesium as unknown as CesiumModule, viewer as never, sprites);
	const settle = () => new Promise((resolve) => setTimeout(resolve));

	return { markers, viewer, sprites, settle };
}

describe('SummitMarkers', () => {
	it('puts the disc at the summit at once, clamped to the terrain and faded by distance', () => {
		const { markers, viewer } = setup();

		markers.show(SUMMIT);

		const disc = viewer.entities.getById('summit-marker')!.billboard!;
		expect(disc.image!.getValue(NOW)).toBe('disc@1');
		expect(disc.heightReference!.getValue(NOW)).toBe(cesium.HeightReference.CLAMP_TO_TERRAIN);
		expect(disc.disableDepthTestDistance).toBeUndefined();
		const distance = disc.distanceDisplayCondition!.getValue(
			NOW
		) as cesium.DistanceDisplayCondition;
		expect(distance.far).toBe(SUMMIT_MARKER_STYLE.maxDistanceMeters);

		const position = viewer.entities.getById('summit-marker')!.position!.getValue(NOW)!;
		const expected = cesium.Cartesian3.fromDegrees(7, 46, 4478);
		expect(cesium.Cartesian3.equals(position, expected)).toBe(true);
	});

	it('adds the pill above the disc once it is drawn, at the same summit and with the same fade', async () => {
		const { markers, viewer, sprites, settle } = setup();

		markers.show(SUMMIT);
		expect(viewer.entities.getById('summit-label')).toBeUndefined();

		sprites.finish();
		await settle();

		const disc = viewer.entities.getById('summit-marker')!;
		const label = viewer.entities.getById('summit-label')!;
		const pill = label.billboard!;
		expect(pill.image!.getValue(NOW)).toBe('pill:Matterhorn');
		expect(pill.verticalOrigin!.getValue(NOW)).toBe(cesium.VerticalOrigin.BOTTOM);
		expect(pill.heightReference!.getValue(NOW)).toBe(cesium.HeightReference.CLAMP_TO_TERRAIN);
		expect(
			cesium.Cartesian3.equals(label.position!.getValue(NOW)!, disc.position!.getValue(NOW)!)
		).toBe(true);

		const offset = pill.pixelOffset!.getValue(NOW) as cesium.Cartesian2;
		expect(offset.x).toBe(0);
		expect(offset.y).toBe(14 - SUMMIT_MARKER_STYLE.labelOffsetPixels);
	});

	it('asks for sprites at the pixel density the canvas renders at', () => {
		const { markers, sprites, viewer } = setup({ width: 2000, clientWidth: 1000 });

		markers.show(SUMMIT);

		expect(sprites.pillRequests).toEqual([
			{
				name: 'Matterhorn',
				elevation: '4,478 m',
				ratio: 2,
				maxContentWidth: SUMMIT_MARKER_STYLE.pill.maxContentWidth
			}
		]);
		expect(viewer.entities.getById('summit-marker')!.billboard!.image!.getValue(NOW)).toBe(
			'disc@2'
		);
	});

	it('keeps the pill between the control columns on a narrow stage', () => {
		const { markers, sprites } = setup({ width: 320, clientWidth: 320 });

		markers.show(SUMMIT);

		expect(sprites.pillRequests[0]!.maxContentWidth).toBe(
			summitPillMaxContentWidth(320, 16, SUMMIT_MARKER_STYLE.pill.summitScale)
		);
		expect(sprites.pillRequests[0]!.maxContentWidth).toBeLessThan(
			SUMMIT_MARKER_STYLE.pill.maxContentWidth
		);
	});

	it('shows one summit at a time', async () => {
		const { markers, viewer, sprites, settle } = setup();

		markers.show(SUMMIT);
		sprites.finish(0);
		await settle();
		markers.show({ ...SUMMIT, name: 'Weisshorn' });
		sprites.finish(1);
		await settle();

		expect(viewer.entities.values.map((entity) => entity.id).sort()).toEqual([
			'summit-label',
			'summit-marker'
		]);
		expect(viewer.entities.getById('summit-label')!.billboard!.image!.getValue(NOW)).toBe(
			'pill:Weisshorn'
		);
		markers.hide();
		expect(viewer.entities.values).toHaveLength(0);
	});

	it('drops a pill that finishes after its summit was hidden or replaced', async () => {
		const { markers, viewer, sprites, settle } = setup();

		markers.show(SUMMIT);
		markers.hide();
		sprites.finish(0);
		await settle();
		expect(viewer.entities.values).toHaveLength(0);

		markers.show(SUMMIT);
		markers.show({ ...SUMMIT, name: 'Weisshorn' });
		sprites.finish(1);
		sprites.finish(2);
		await settle();
		expect(viewer.entities.getById('summit-label')!.billboard!.image!.getValue(NOW)).toBe(
			'pill:Weisshorn'
		);
		expect(viewer.entities.values).toHaveLength(2);
	});

	it('leaves the disc alone when the pill cannot be drawn', async () => {
		const { markers, viewer, sprites, settle } = setup();

		markers.show(SUMMIT);
		sprites.fail();
		await settle();

		expect(viewer.entities.values.map((entity) => entity.id)).toEqual(['summit-marker']);
	});

	it('touches nothing once the viewer is destroyed', async () => {
		const { markers, viewer, sprites, settle } = setup();

		markers.show(SUMMIT);
		viewer.destroyed = true;
		sprites.finish();
		await settle();
		markers.hide();

		expect(viewer.entities.getById('summit-label')).toBeUndefined();
	});
});
