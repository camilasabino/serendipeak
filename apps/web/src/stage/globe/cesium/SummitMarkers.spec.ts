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
	name: 'Matterhorn'
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

	finish(index = 0, image = `pill:${this.pillRequests[index]!.name}`): void {
		this.waiting[index]!.resolve({
			image,
			width: 180,
			height: 62,
			bottomInset: 14
		});
	}

	fail(index = 0): void {
		this.waiting[index]!.reject(new Error('no canvas'));
	}
}

class FakeLayout {
	matches: boolean;
	private readonly listeners = new Set<() => void>();

	constructor(compact: boolean) {
		this.matches = compact;
	}

	get listenerCount(): number {
		return this.listeners.size;
	}

	addEventListener(_type: 'change', listener: () => void): void {
		this.listeners.add(listener);
	}

	removeEventListener(_type: 'change', listener: () => void): void {
		this.listeners.delete(listener);
	}

	switchTo(compact: boolean): void {
		this.matches = compact;
		[...this.listeners].forEach((listener) => listener());
	}
}

function setup(canvas = { width: 1000, clientWidth: 1000 }, compact = false) {
	const viewer = {
		entities: new cesium.EntityCollection(),
		scene: { canvas },
		destroyed: false,
		isDestroyed() {
			return this.destroyed;
		}
	};
	const sprites = new FakeSprites();
	const layout = new FakeLayout(compact);
	const markers = new SummitMarkers(
		cesium as unknown as CesiumModule,
		viewer as never,
		sprites,
		layout
	);
	const settle = () => new Promise((resolve) => setTimeout(resolve));

	return { markers, viewer, sprites, settle, layout };
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

	describe('unit system', () => {
		const label = (viewer: ReturnType<typeof setup>['viewer']) =>
			viewer.entities.getById('summit-label')!;
		const image = (viewer: ReturnType<typeof setup>['viewer']) =>
			label(viewer).billboard!.image!.getValue(NOW);

		it('words the pill in meters until told otherwise', () => {
			const { markers, sprites } = setup();

			markers.show(SUMMIT);

			expect(sprites.pillRequests.map((request) => request.elevation)).toEqual(['4,478 m']);
		});

		it('draws a first pill in the unit set before the summit showed', () => {
			const { markers, sprites } = setup();

			markers.setUnitSystem('imperial');
			markers.show(SUMMIT);

			expect(sprites.pillRequests.map((request) => request.elevation)).toEqual(['14,692 ft']);
		});

		it('redraws the shown pill in place, keeping the old one until the new one is ready', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);
			sprites.finish(0, 'pill:metres');
			await settle();
			const disc = viewer.entities.getById('summit-marker')!;
			const pill = label(viewer);

			markers.setUnitSystem('imperial');
			expect(sprites.pillRequests[1]).toMatchObject({ name: 'Matterhorn', elevation: '14,692 ft' });
			expect(image(viewer)).toBe('pill:metres');

			sprites.finish(1, 'pill:feet');
			await settle();

			expect(label(viewer)).toBe(pill);
			expect(image(viewer)).toBe('pill:feet');
			expect(viewer.entities.getById('summit-marker')).toBe(disc);
			expect(disc.billboard!.image!.getValue(NOW)).toBe('disc@1');
			expect(viewer.entities.values).toHaveLength(2);
		});

		it('keeps the pill at the summit with the same fade and anchor after a redraw', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);
			sprites.finish(0);
			await settle();
			const position = label(viewer).position!.getValue(NOW)!.clone();

			markers.setUnitSystem('imperial');
			sprites.finish(1);
			await settle();

			const pill = label(viewer).billboard!;
			expect(cesium.Cartesian3.equals(label(viewer).position!.getValue(NOW)!, position)).toBe(true);
			expect(pill.verticalOrigin!.getValue(NOW)).toBe(cesium.VerticalOrigin.BOTTOM);
			expect(pill.heightReference!.getValue(NOW)).toBe(cesium.HeightReference.CLAMP_TO_TERRAIN);
			const offset = pill.pixelOffset!.getValue(NOW) as cesium.Cartesian2;
			expect(offset.y).toBe(14 - SUMMIT_MARKER_STYLE.labelOffsetPixels);
		});

		it('is idempotent: the same unit asks for nothing', async () => {
			const { markers, sprites, settle } = setup();
			markers.show(SUMMIT);
			sprites.finish(0);
			await settle();

			markers.setUnitSystem('metric');
			markers.setUnitSystem('imperial');
			markers.setUnitSystem('imperial');

			expect(sprites.pillRequests.map((request) => request.elevation)).toEqual([
				'4,478 m',
				'14,692 ft'
			]);
		});

		it('discards a pill drawn for a previous unit, whatever order they finish in', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);
			sprites.finish(0, 'pill:metres');
			await settle();

			markers.setUnitSystem('imperial');
			markers.setUnitSystem('metric');
			sprites.finish(2, 'pill:metres-again');
			await settle();
			sprites.finish(1, 'pill:feet-late');
			await settle();

			expect(image(viewer)).toBe('pill:metres-again');
		});

		it('discards a pill that finishes late for the unit no longer wanted, leaving the current one', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);
			sprites.finish(0, 'pill:metres');
			await settle();

			markers.setUnitSystem('imperial');
			markers.setUnitSystem('metric');
			sprites.finish(1, 'pill:feet-late');
			await settle();
			expect(image(viewer)).toBe('pill:metres');

			sprites.finish(2, 'pill:metres-again');
			await settle();
			expect(image(viewer)).toBe('pill:metres-again');
		});

		it('replaces a first pill still being drawn when the unit changes under it', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);

			markers.setUnitSystem('imperial');
			sprites.finish(0, 'pill:metres');
			await settle();
			expect(viewer.entities.getById('summit-label')).toBeUndefined();

			sprites.finish(1, 'pill:feet');
			await settle();
			expect(image(viewer)).toBe('pill:feet');
		});

		it('draws nothing for a unit change while no summit is showing, and drops a pill pending at hide', async () => {
			const { markers, viewer, sprites, settle } = setup();

			markers.setUnitSystem('imperial');
			expect(sprites.pillRequests).toHaveLength(0);

			markers.show(SUMMIT);
			markers.hide();
			markers.setUnitSystem('metric');
			sprites.finish(0);
			await settle();

			expect(sprites.pillRequests).toHaveLength(1);
			expect(viewer.entities.values).toHaveLength(0);
		});

		it('keeps the unit across summits', async () => {
			const { markers, sprites } = setup();
			markers.setUnitSystem('imperial');

			markers.show(SUMMIT);
			markers.show({ ...SUMMIT, name: 'Weisshorn', elevationMeters: 4506 });

			expect(sprites.pillRequests.map((request) => request.elevation)).toEqual([
				'14,692 ft',
				'14,783 ft'
			]);
		});

		it('draws no pill on the phone layout for a unit change, and uses the unit on return', async () => {
			const { markers, viewer, sprites, settle, layout } = setup(undefined, true);
			markers.show(SUMMIT);

			markers.setUnitSystem('imperial');
			await settle();
			expect(sprites.pillRequests).toHaveLength(0);
			expect(viewer.entities.values.map((entity) => entity.id)).toEqual(['summit-marker']);

			layout.switchTo(false);
			expect(sprites.pillRequests.map((request) => request.elevation)).toEqual(['14,692 ft']);
		});

		it('touches nothing once the viewer is destroyed', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);
			sprites.finish(0);
			await settle();

			viewer.destroyed = true;

			expect(() => markers.setUnitSystem('imperial')).not.toThrow();
			expect(sprites.pillRequests).toHaveLength(1);
		});
	});

	describe('visibility', () => {
		const ids = (viewer: ReturnType<typeof setup>['viewer']) =>
			viewer.entities.values.map((entity) => entity.id).sort();

		it('is drawn until told otherwise', () => {
			const { markers, viewer } = setup();

			markers.setVisible(true);
			markers.show(SUMMIT);

			expect(ids(viewer)).toEqual(['summit-marker']);
		});

		it('takes the disc and the pill off the stage, and draws both again on return', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);
			sprites.finish(0);
			await settle();
			expect(ids(viewer)).toEqual(['summit-label', 'summit-marker']);

			markers.setVisible(false);
			expect(ids(viewer)).toEqual([]);

			markers.setVisible(true);
			expect(ids(viewer)).toEqual(['summit-marker']);
			sprites.finish(1);
			await settle();
			expect(ids(viewer)).toEqual(['summit-label', 'summit-marker']);
			expect(sprites.pillRequests.map((request) => request.name)).toEqual([
				'Matterhorn',
				'Matterhorn'
			]);
		});

		it('keeps the summit at the same place across a hide', () => {
			const { markers, viewer } = setup();
			markers.show(SUMMIT);

			markers.setVisible(false);
			markers.setVisible(true);

			const position = viewer.entities.getById('summit-marker')!.position!.getValue(NOW)!;
			expect(cesium.Cartesian3.equals(position, cesium.Cartesian3.fromDegrees(7, 46, 4478))).toBe(
				true
			);
		});

		it('drops a pill still being drawn when hidden', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);

			markers.setVisible(false);
			sprites.finish(0);
			await settle();

			expect(ids(viewer)).toEqual([]);
		});

		it('draws nothing for a summit shown while hidden, and the one shown now on return', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.setVisible(false);

			markers.show(SUMMIT);
			markers.show({ ...SUMMIT, name: 'Weisshorn' });
			await settle();
			expect(ids(viewer)).toEqual([]);
			expect(sprites.pillRequests).toHaveLength(0);

			markers.setVisible(true);
			sprites.finish(0);
			await settle();
			expect(ids(viewer)).toEqual(['summit-label', 'summit-marker']);
			expect(viewer.entities.getById('summit-label')!.billboard!.image!.getValue(NOW)).toBe(
				'pill:Weisshorn'
			);
		});

		it('draws nothing on return once the summit was let go while hidden', async () => {
			const { markers, viewer, sprites } = setup();
			markers.show(SUMMIT);
			markers.setVisible(false);

			markers.hide();
			markers.setVisible(true);

			expect(ids(viewer)).toEqual([]);
			expect(sprites.pillRequests).toHaveLength(1);
		});

		it('is idempotent: the same state draws and asks for nothing more', async () => {
			const { markers, viewer, sprites, settle } = setup();
			markers.show(SUMMIT);
			sprites.finish(0);
			await settle();

			markers.setVisible(true);
			markers.setVisible(true);
			expect(sprites.pillRequests).toHaveLength(1);
			expect(ids(viewer)).toEqual(['summit-label', 'summit-marker']);

			markers.setVisible(false);
			markers.setVisible(false);
			markers.setVisible(true);
			expect(sprites.pillRequests).toHaveLength(2);
		});

		it('words a pill redrawn on return in the unit chosen while hidden', () => {
			const { markers, sprites } = setup();
			markers.show(SUMMIT);
			markers.setVisible(false);

			markers.setUnitSystem('imperial');
			expect(sprites.pillRequests).toHaveLength(1);

			markers.setVisible(true);
			expect(sprites.pillRequests.at(-1)!.elevation).toMatch(/ft/);
		});

		it('keeps to the phone layout on return: the disc alone', async () => {
			const { markers, viewer, sprites, settle } = setup(undefined, true);
			markers.show(SUMMIT);

			markers.setVisible(false);
			markers.setVisible(true);
			await settle();

			expect(ids(viewer)).toEqual(['summit-marker']);
			expect(sprites.pillRequests).toHaveLength(0);
		});

		it('ignores a layout change while hidden, and obeys the layout on return', async () => {
			const { markers, viewer, sprites, settle, layout } = setup(undefined, true);
			markers.show(SUMMIT);
			markers.setVisible(false);

			layout.switchTo(false);
			await settle();
			expect(ids(viewer)).toEqual([]);
			expect(sprites.pillRequests).toHaveLength(0);

			markers.setVisible(true);
			sprites.finish(0);
			await settle();
			expect(ids(viewer)).toEqual(['summit-label', 'summit-marker']);
		});

		it('touches nothing once the viewer is destroyed', () => {
			const { markers, viewer } = setup();
			markers.show(SUMMIT);
			viewer.destroyed = true;

			expect(() => {
				markers.setVisible(false);
				markers.setVisible(true);
			}).not.toThrow();
		});
	});

	describe('on the phone layout', () => {
		it('keeps the disc and never draws a pill', async () => {
			const { markers, viewer, sprites, settle } = setup(undefined, true);

			markers.show(SUMMIT);
			await settle();

			expect(viewer.entities.values.map((entity) => entity.id)).toEqual(['summit-marker']);
			expect(sprites.pillRequests).toHaveLength(0);
		});

		it('drops a pill still being drawn when the layout turns compact, and restores it on return', async () => {
			const { markers, viewer, sprites, settle, layout } = setup();

			markers.show(SUMMIT);
			layout.switchTo(true);
			sprites.finish(0);
			await settle();
			expect(viewer.entities.values.map((entity) => entity.id)).toEqual(['summit-marker']);

			layout.switchTo(false);
			sprites.finish(1);
			await settle();
			expect(viewer.entities.values.map((entity) => entity.id).sort()).toEqual([
				'summit-label',
				'summit-marker'
			]);
		});

		it('removes a shown pill when the layout turns compact, leaving the disc where it was', async () => {
			const { markers, viewer, sprites, settle, layout } = setup();

			markers.show(SUMMIT);
			sprites.finish();
			await settle();
			const before = viewer.entities.getById('summit-marker')!.position!.getValue(NOW)!;

			layout.switchTo(true);

			expect(viewer.entities.values.map((entity) => entity.id)).toEqual(['summit-marker']);
			expect(
				cesium.Cartesian3.equals(
					viewer.entities.getById('summit-marker')!.position!.getValue(NOW)!,
					before
				)
			).toBe(true);
		});

		it('listens only while a summit is showing', () => {
			const { markers, layout } = setup();

			markers.show(SUMMIT);
			markers.show({ ...SUMMIT, name: 'Weisshorn' });
			expect(layout.listenerCount).toBe(1);

			markers.hide();
			expect(layout.listenerCount).toBe(0);
		});

		it('ignores a layout change once nothing is showing', async () => {
			const { markers, viewer, layout } = setup();

			markers.show(SUMMIT);
			markers.hide();
			layout.switchTo(false);

			expect(viewer.entities.values).toHaveLength(0);
		});
	});
});
