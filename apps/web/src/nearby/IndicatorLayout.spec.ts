import { describe, expect, it } from 'vitest';
import type { ScreenBox } from '../stage/globe/atlasMarkers';
import { summitMarkerFootprint } from '../stage/globe/marker';
import type {
	Concealment,
	NearbySighting,
	SummitSighting,
	SummitSightings
} from '../stage/globe/summitSighting';
import {
	IndicatorLayout,
	type HiddenReason,
	type IndicatorSurface,
	type MarkPosition,
	type MarkSizes
} from './IndicatorLayout';

const STAGE = { width: 960, height: 600 };
const SIZES: MarkSizes = { chip: { width: 120, height: 44 }, label: { width: 110, height: 32 } };
const SLUGS = ['el-plata', 'ojos-del-salado'];

class FakeSurface implements IndicatorSurface {
	readonly shown = new Map<string, MarkPosition>();
	readonly hidden = new Map<string, HiddenReason>();
	readonly writes: string[] = [];
	counts: number[] = [];
	controls: ScreenBox[] = [];
	focus: string | undefined;
	sizeOf = new Map<string, MarkSizes>(SLUGS.map((slug) => [slug, SIZES]));

	sizes(slug: string) {
		return this.sizeOf.get(slug);
	}

	obstacles() {
		return [...this.controls];
	}

	rootFontPixels() {
		return 16;
	}

	focused() {
		return this.focus;
	}

	show(slug: string, position: MarkPosition) {
		this.shown.set(slug, position);
		this.hidden.delete(slug);
		this.writes.push(`show ${slug}`);
	}

	hide(slug: string, reason: HiddenReason | undefined) {
		this.shown.delete(slug);
		if (reason) {
			this.hidden.set(slug, reason);
		} else {
			this.hidden.delete(slug);
		}
		this.writes.push(`hide ${slug} ${reason}`);
	}

	shownCount(count: number) {
		this.counts.push(count);
	}
}

const ahead = (x: number, y: number): SummitSighting => ({ kind: 'ahead', x, y });

function reading(
	plata: SummitSighting,
	ojos: SummitSighting = ahead(1500, 300),
	presented: SummitSighting = ahead(480, 360),
	concealed: { plata?: Concealment; ojos?: Concealment } = {}
): SummitSightings {
	return {
		viewport: STAGE,
		presented,
		nearby: [
			{ slug: 'el-plata', sighting: plata, ...(concealed.plata && { concealed: concealed.plata }) },
			{
				slug: 'ojos-del-salado',
				sighting: ojos,
				...(concealed.ojos && { concealed: concealed.ojos })
			}
		]
	};
}

/** A summit in the frame that the horizon or terrain hides, with the sighting of its bearing. */
function hidden(
	slug: string,
	sighting: SummitSighting,
	bearing: SummitSighting,
	concealed: Concealment = 'horizon'
): NearbySighting {
	return { slug, sighting, concealed, bearing };
}

function readingOf(
	nearby: NearbySighting[],
	presented: SummitSighting = ahead(480, 360),
	viewport = STAGE
): SummitSightings {
	return { viewport, presented, nearby };
}

type Bearing = Extract<MarkPosition, { mode: 'bearing' }>;

function setup(slugs: readonly string[] = SLUGS) {
	const surface = new FakeSurface();
	return { surface, layout: new IndicatorLayout(slugs, surface) };
}

function overlapping(a: ScreenBox, b: ScreenBox): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

describe('IndicatorLayout', () => {
	it('shows nothing without a reading', () => {
		const { surface, layout } = setup();

		layout.update(undefined);

		expect(surface.writes).toEqual([]);
		expect(surface.counts).toEqual([0]);
	});

	describe('off screen', () => {
		it('puts a chip at the edge the summit lies past, with the arrow toward it', () => {
			const { surface, layout } = setup();

			layout.update(reading(ahead(1500, 300), ahead(-500, 300)));

			expect(surface.shown.get('el-plata')).toEqual({
				mode: 'edge',
				left: 960 - 12 - 120,
				top: 278,
				edge: 'right',
				angleDegrees: 0
			});
			expect(surface.shown.get('ojos-del-salado')).toMatchObject({ mode: 'edge', edge: 'left' });
		});

		it('turns the arrow toward the true direction, including a summit behind the camera', () => {
			const { surface, layout } = setup();

			layout.update(reading({ kind: 'behind', dx: -Math.SQRT1_2, dy: Math.SQRT1_2 }));

			const shown = surface.shown.get('el-plata');
			expect(shown?.mode === 'edge' && shown.angleDegrees).toBeCloseTo(135, 6);
		});

		it('shows no mark, and says why, for a direction that cannot be trusted', () => {
			const { surface, layout } = setup();

			layout.update(reading({ kind: 'unknown' }));

			expect(surface.shown.has('el-plata')).toBe(false);
			expect(surface.hidden.get('el-plata')).toBe('unreliable');
		});

		it('keeps clear of the controls and of the presented summit marker', () => {
			const { surface, layout } = setup();
			surface.controls = [{ left: 900, top: 0, right: 960, bottom: 600 }];
			const presented = ahead(760, 330);
			const footprint = summitMarkerFootprint({ x: 760, y: 330 }, 960, 16);

			layout.update(reading(ahead(1500, 300), undefined, presented));

			const shown = surface.shown.get('el-plata') as Extract<MarkPosition, { mode: 'edge' }>;
			const box = {
				left: shown.left,
				top: shown.top,
				right: shown.left + 120,
				bottom: shown.top + 44
			};
			for (const obstacle of [...surface.controls, footprint]) {
				expect(
					box.left < obstacle.right &&
						obstacle.left < box.right &&
						box.top < obstacle.bottom &&
						obstacle.top < box.bottom
				).toBe(false);
			}
		});

		it('gives the nearest mountain the place when two point the same way', () => {
			const { surface, layout } = setup();

			layout.update(reading(ahead(1500, 300), ahead(1500, 300)));

			expect(surface.shown.get('el-plata')).toMatchObject({ top: 278 });
			expect(surface.shown.get('ojos-del-salado')).not.toMatchObject({ top: 278 });
		});

		it('says so when an edge has no room left for a mountain', () => {
			const { surface, layout } = setup();
			surface.controls = [{ left: 0, top: 0, right: 960, bottom: 600 }];

			layout.update(reading(ahead(1500, 300)));

			expect(surface.hidden.get('el-plata')).toBe('no-room');
		});
	});

	describe('in view', () => {
		it('stands a marker exactly on the summit, named where there is room', () => {
			const { surface, layout } = setup();

			layout.update(reading(ahead(300, 200)));

			expect(surface.shown.get('el-plata')).toEqual({
				mode: 'summit',
				x: 300,
				y: 200,
				label: expect.objectContaining({ dx: expect.any(Number), dy: expect.any(Number) })
			});
		});

		it('hands the same mountain from chip to marker and back across the edge, without blinking', () => {
			const { surface, layout } = setup();
			layout.update(reading(ahead(1000, 300)));
			expect(surface.shown.get('el-plata')?.mode).toBe('edge');

			// Inside the stage but not yet past the margin an off-screen summit must clear.
			layout.update(reading(ahead(950, 300)));
			expect(surface.shown.get('el-plata')?.mode).toBe('edge');

			layout.update(reading(ahead(900, 300)));
			expect(surface.shown.get('el-plata')).toMatchObject({ mode: 'summit', x: 900, y: 300 });

			// Back toward the edge, still inside: the marker stays until the summit leaves.
			layout.update(reading(ahead(955, 300)));
			expect(surface.shown.get('el-plata')?.mode).toBe('summit');

			layout.update(reading(ahead(965, 300)));
			expect(surface.shown.get('el-plata')?.mode).toBe('edge');
		});

		it('never marks a summit in view that terrain or the horizon hides where it projects', () => {
			const { surface, layout } = setup();

			layout.update(
				readingOf([
					hidden('el-plata', ahead(300, 200), ahead(300, 150), 'terrain'),
					{ slug: 'ojos-del-salado', sighting: ahead(700, 200) }
				])
			);

			expect(surface.shown.get('el-plata')?.mode).toBe('bearing');
			expect(surface.shown.get('ojos-del-salado')?.mode).toBe('summit');
		});

		it('leaves out a marker that would sit on the presented summit marker or a control', () => {
			const { surface, layout } = setup();
			surface.controls = [{ left: 700, top: 150, right: 760, bottom: 250 }];

			layout.update(reading(ahead(482, 362), ahead(730, 200), ahead(480, 360)));

			expect(surface.hidden.get('el-plata')).toBe('covered');
			expect(surface.hidden.get('ojos-del-salado')).toBe('covered');
		});

		it('keeps the disc without a name when no place beside it is free', () => {
			const { surface, layout } = setup();
			surface.controls = [{ left: 0, top: 0, right: 960, bottom: 190 }];
			surface.controls.push({ left: 0, top: 210, right: 960, bottom: 600 });

			layout.update(reading(ahead(480, 200)));

			expect(surface.shown.get('el-plata')).toMatchObject({ mode: 'summit', label: undefined });
		});

		it('makes room at the edge for a marker, which the chips never take', () => {
			const { surface, layout } = setup();

			layout.update(reading(ahead(890, 300), ahead(1500, 300)));

			const marker = surface.shown.get('el-plata');
			const chip = surface.shown.get('ojos-del-salado') as Extract<MarkPosition, { mode: 'edge' }>;
			expect(marker?.mode).toBe('summit');
			expect(chip.mode).toBe('edge');
			expect(chip.top + 44 <= 300 - 6 || chip.top >= 300 + 6).toBe(true);
		});
	});

	describe('as it showed on Mount Everest, 624 × 487', () => {
		const everest: SummitSightings = {
			viewport: { width: 624, height: 487 },
			presented: ahead(326.7, 144.4),
			nearby: [
				{ slug: 'ama-dablam', sighting: ahead(987.3, 232.3) },
				{ slug: 'kangchenjunga', sighting: ahead(336.1, 162.3) },
				{ slug: 'machapuchare', sighting: { kind: 'behind', dx: 0.021, dy: 0.9998 } }
			]
		};
		const slugs = everest.nearby.map((entry) => entry.slug);

		it('names Kangchenjunga on its bearing, clear of Everest’s marker, when terrain hides it right behind', () => {
			const { surface, layout } = setup(slugs);
			surface.sizeOf = new Map(slugs.map((slug) => [slug, SIZES]));

			layout.update({
				...everest,
				nearby: everest.nearby.map((entry) =>
					entry.slug === 'kangchenjunga'
						? { ...entry, concealed: 'terrain', bearing: ahead(336.1, 150.2) }
						: entry
				)
			});

			const chip = surface.shown.get('kangchenjunga') as Bearing;
			const footprint = summitMarkerFootprint({ x: 326.7, y: 144.4 }, 624, 16);
			expect(chip.mode).toBe('bearing');
			expect(chip.left + chip.leaderX).toBeCloseTo(336.1, 0);
			expect(
				chip.left < footprint.right &&
					footprint.left < chip.left + 120 &&
					chip.top < footprint.bottom &&
					footprint.top < chip.top + 44
			).toBe(false);
			expect(surface.shown.get('ama-dablam')).toMatchObject({ mode: 'edge', edge: 'right' });
			expect(surface.shown.get('machapuchare')).toMatchObject({ mode: 'edge', edge: 'bottom' });
		});

		it('would otherwise cover it with the presented marker, never name it on top of Everest', () => {
			const { surface, layout } = setup(slugs);
			surface.sizeOf = new Map(slugs.map((slug) => [slug, SIZES]));

			layout.update(everest);

			const shown = surface.shown.get('kangchenjunga');
			const label = shown?.mode === 'summit' ? shown.label : undefined;
			const footprint = summitMarkerFootprint({ x: 326.7, y: 144.4 }, 624, 16);
			if (label) {
				const left = 336.1 + label.dx;
				const top = 162.3 + label.dy;
				expect(
					left < footprint.right &&
						footprint.left < left + 110 &&
						top < footprint.bottom &&
						footprint.top < top + 32
				).toBe(false);
			} else {
				expect(surface.hidden.get('kangchenjunga')).toBe('covered');
			}
		});
	});

	describe('hidden in the frame', () => {
		it('stands a chip over the summit’s bearing, joined by a leader to where it meets eye level', () => {
			const { surface, layout } = setup(['el-plata']);

			layout.update(readingOf([hidden('el-plata', ahead(700, 330), ahead(700, 270))]));

			const chip = surface.shown.get('el-plata') as Bearing;
			expect(chip).toMatchObject({ mode: 'bearing', leader: 'down' });
			expect(chip.left + chip.leaderX).toBe(700);
			expect(chip.top + 44 + chip.leaderLength).toBe(270);
			expect(surface.hidden.size).toBe(0);
		});

		it('points from the edge when the bearing leaves the frame, as under a camera looking down', () => {
			const { surface, layout } = setup(['el-plata']);

			layout.update(
				readingOf([hidden('el-plata', ahead(700, 330), { kind: 'behind', dx: 0, dy: -1 })])
			);

			expect(surface.shown.get('el-plata')).toMatchObject({
				mode: 'edge',
				edge: 'top',
				angleDegrees: -90
			});
		});

		it('shows nothing, and says why, when the bearing cannot be trusted', () => {
			const { surface, layout } = setup(['el-plata']);

			layout.update(readingOf([hidden('el-plata', ahead(700, 330), { kind: 'unknown' })]));
			expect(surface.hidden.get('el-plata')).toBe('unreliable');

			layout.update(
				readingOf([{ slug: 'el-plata', sighting: ahead(700, 330), concealed: 'terrain' }])
			);
			expect(surface.hidden.get('el-plata')).toBe('unreliable');
		});

		it('turns its chip into a marker on the summit once it rises over the horizon, and back again', () => {
			const { surface, layout } = setup(['el-plata']);
			surface.focus = 'el-plata';

			layout.update(readingOf([hidden('el-plata', ahead(700, 330), ahead(700, 270))]));
			expect(surface.shown.get('el-plata')?.mode).toBe('bearing');

			// Zooming out: the camera rises until the summit clears the horizon.
			layout.update(readingOf([{ slug: 'el-plata', sighting: ahead(690, 300) }]));
			expect(surface.shown.get('el-plata')).toMatchObject({ mode: 'summit', x: 690, y: 300 });

			// Zooming back in: the horizon takes it again.
			layout.update(readingOf([hidden('el-plata', ahead(700, 330), ahead(700, 270))]));
			expect(surface.shown.get('el-plata')?.mode).toBe('bearing');
			expect(surface.writes.filter((write) => write.startsWith('hide'))).toEqual([]);
		});

		it('follows the bearing across the stage as the camera turns, then points from the edge', () => {
			const { surface, layout } = setup(['el-plata']);
			const column = () => {
				const chip = surface.shown.get('el-plata') as Bearing;
				return chip.left + chip.leaderX;
			};

			layout.update(readingOf([hidden('el-plata', ahead(500, 330), ahead(500, 270))]));
			expect(column()).toBe(500);
			layout.update(readingOf([hidden('el-plata', ahead(300, 330), ahead(300, 270))]));
			expect(column()).toBe(300);

			layout.update(readingOf([{ slug: 'el-plata', sighting: ahead(-200, 330) }]));
			expect(surface.shown.get('el-plata')).toMatchObject({ mode: 'edge', edge: 'left' });
		});

		it('keeps a bearing near the edge from switching to an edge chip and back', () => {
			const { surface, layout } = setup(['el-plata']);

			layout.update(readingOf([hidden('el-plata', ahead(700, 330), ahead(700, -10))]));
			expect(surface.shown.get('el-plata')?.mode).toBe('edge');

			layout.update(readingOf([hidden('el-plata', ahead(700, 330), ahead(700, 10))]));
			expect(surface.shown.get('el-plata')?.mode).toBe('edge');

			layout.update(readingOf([hidden('el-plata', ahead(700, 330), ahead(700, 40))]));
			expect(surface.shown.get('el-plata')?.mode).toBe('bearing');
		});

		it('says so when a bearing has no free place along its column', () => {
			const { surface, layout } = setup(['el-plata']);
			surface.controls = [{ left: 600, top: 0, right: 800, bottom: 600 }];

			layout.update(readingOf([hidden('el-plata', ahead(700, 330), ahead(700, 270))]));

			expect(surface.hidden.get('el-plata')).toBe('no-room');
		});

		it('keeps a focused bearing chip in place while its direction becomes untrustworthy', () => {
			const { surface, layout } = setup(['el-plata']);
			layout.update(readingOf([hidden('el-plata', ahead(700, 330), ahead(700, 270))]));
			const before = surface.shown.get('el-plata');
			surface.focus = 'el-plata';

			layout.update(readingOf([hidden('el-plata', ahead(700, 330), { kind: 'unknown' })]));

			expect(surface.shown.get('el-plata')).toEqual(before);
		});
	});

	describe('as it showed on Aneto, 1440 × 900', () => {
		// Mont Blanc, the Matterhorn and the Eiger: in the frame, beyond the horizon, a few degrees
		// apart in bearing. Each was hidden as concealed; each now stands on its own bearing.
		const WIDE = { width: 1440, height: 900 };
		const aneto = readingOf(
			[
				hidden('mont-blanc', ahead(1026, 379), ahead(1029, 318)),
				hidden('matterhorn', ahead(1066, 387), ahead(1069, 326)),
				hidden('eiger', ahead(988, 393), ahead(991, 331))
			],
			ahead(720, 353),
			WIDE
		);
		const slugs = aneto.nearby.map((entry) => entry.slug);

		it('names all three, each on its own column, none over another or over Aneto’s marker', () => {
			const { surface, layout } = setup(slugs);
			surface.sizeOf = new Map(slugs.map((slug) => [slug, SIZES]));

			layout.update(aneto);

			const chips = slugs.map((slug) => surface.shown.get(slug) as Bearing);
			expect(chips.map((chip) => chip?.mode)).toEqual(['bearing', 'bearing', 'bearing']);
			expect(chips.map((chip) => chip.left + chip.leaderX)).toEqual([1029, 1069, 991]);
			const boxes = chips.map((chip) => ({
				left: chip.left,
				top: chip.top,
				right: chip.left + 120,
				bottom: chip.top + 44
			}));
			const footprint = summitMarkerFootprint({ x: 720, y: 353 }, 1440, 16);
			for (const [index, box] of boxes.entries()) {
				expect(overlapping(box, footprint)).toBe(false);
				for (const other of boxes.slice(index + 1)) {
					expect(overlapping(box, other)).toBe(false);
				}
			}
			expect(surface.counts.at(-1)).toBe(3);
		});

		it('marks Mont Blanc on its summit once zooming out clears the horizon, the others still on their bearings', () => {
			const { surface, layout } = setup(slugs);
			surface.sizeOf = new Map(slugs.map((slug) => [slug, SIZES]));

			layout.update(
				readingOf(
					[
						{ slug: 'mont-blanc', sighting: ahead(951, 397) },
						hidden('matterhorn', ahead(986, 401), ahead(988, 300)),
						hidden('eiger', ahead(931, 405), ahead(933, 304))
					],
					ahead(720, 430),
					WIDE
				)
			);

			expect(surface.shown.get('mont-blanc')).toMatchObject({ mode: 'summit', x: 951, y: 397 });
			expect(surface.shown.get('matterhorn')?.mode).toBe('bearing');
			expect(surface.shown.get('eiger')?.mode).toBe('bearing');
		});
	});

	describe('keyboard focus', () => {
		it('keeps a mark in place while focus is on it and its summit would take it away', () => {
			const { surface, layout } = setup();
			layout.update(reading(ahead(1500, 300)));
			const chip = surface.shown.get('el-plata');
			surface.focus = 'el-plata';

			layout.update(reading({ kind: 'unknown' }));
			expect(surface.shown.get('el-plata')).toBe(chip);

			surface.focus = undefined;
			layout.relayout();
			expect(surface.shown.has('el-plata')).toBe(false);
			expect(surface.hidden.get('el-plata')).toBe('unreliable');
		});

		it('still follows a summit that can be shown, with focus on it', () => {
			const { surface, layout } = setup();
			layout.update(reading(ahead(1500, 300)));
			surface.focus = 'el-plata';

			layout.update(reading(ahead(300, 200)));

			expect(surface.shown.get('el-plata')?.mode).toBe('summit');
		});
	});

	it('counts the marks shown, so the surface can drop an empty group', () => {
		const { surface, layout } = setup();

		layout.update(reading(ahead(1500, 300), ahead(300, 200)));
		layout.update(reading({ kind: 'unknown' }, { kind: 'unknown' }));

		expect(surface.counts).toEqual([2, 0]);
	});

	it('writes nothing while the marks stay where they are', () => {
		const { surface, layout } = setup();
		layout.update(reading(ahead(1500, 300), ahead(300, 200)));
		const writes = surface.writes.length;

		layout.update(reading(ahead(1500, 300.1), ahead(300.2, 200)));
		layout.relayout();

		expect(surface.writes).toHaveLength(writes);
	});

	it('shows nothing for a reading taken for another list of mountains, as before a navigation', () => {
		const { surface, layout } = setup();
		layout.update(reading(ahead(1500, 300)));

		layout.update({
			viewport: STAGE,
			presented: ahead(480, 300),
			nearby: [{ slug: 'el-plata', sighting: ahead(1500, 300) }]
		});

		expect(surface.shown.size).toBe(0);
	});

	it('lays out again with the latest reading when the labels change size', () => {
		const { surface, layout } = setup();
		layout.update(reading(ahead(1500, 300)));

		surface.sizeOf.set('el-plata', { ...SIZES, chip: { width: 160, height: 44 } });
		layout.relayout();

		expect(surface.shown.get('el-plata')).toMatchObject({ left: 960 - 12 - 160 });
	});

	it('hides everything on release and ignores readings after it', () => {
		const { surface, layout } = setup();
		layout.update(reading(ahead(1500, 300), ahead(300, 200)));
		surface.focus = 'el-plata';

		layout.release();
		layout.update(reading(ahead(1500, 300)));

		expect(surface.shown.size).toBe(0);
	});
});
