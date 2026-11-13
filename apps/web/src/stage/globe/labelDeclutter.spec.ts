import { describe, expect, it } from 'vitest';
import type { ScreenBox } from './atlasMarkers';
import { LABEL_DECLUTTER, declutterLabels, labelBox, type LabelCandidate } from './labelDeclutter';
import { MARKER_LABEL_PLATE } from './marker';

function box(left: number, top: number, width = 80, height = 20): ScreenBox {
	return { left, top, right: left + width, bottom: top + height };
}

function label(
	slug: string,
	at: ScreenBox,
	elevationMeters = 3000,
	shown = false,
	fading = false
): LabelCandidate {
	return { slug, elevationMeters, box: at, shown, fading };
}

const sorted = (shown: Set<string>) => [...shown].sort();

describe('label plate', () => {
	it('centres the plate over the marker, its bottom edge raised by the offset', () => {
		const { paddingPixels } = MARKER_LABEL_PLATE;

		expect(labelBox({ x: 200, y: 100, text: { width: 60, height: 13 }, offsetPixels: 7 })).toEqual({
			left: 200 - 30 - paddingPixels.x,
			right: 200 + 30 + paddingPixels.x,
			top: 93 - 13 - paddingPixels.y * 2,
			bottom: 93
		});
	});
});

describe('label declutter', () => {
	it('shows every label when none overlap', () => {
		const shown = declutterLabels([label('a', box(0, 0)), label('b', box(200, 0))]);

		expect(sorted(shown)).toEqual(['a', 'b']);
	});

	it('keeps the higher summit when two labels overlap', () => {
		const shown = declutterLabels([
			label('cerro-torre', box(0, 0), 3133),
			label('fitz-roy', box(40, 10), 3405)
		]);

		expect(sorted(shown)).toEqual(['fitz-roy']);
	});

	it('lets a legible name outrank a higher summit whose label is fading out', () => {
		const shown = declutterLabels([
			label('far-higher', box(0, 0), 8000, true, true),
			label('near-lower', box(10, 0), 2000, false, false)
		]);

		expect(sorted(shown)).toEqual(['near-lower']);
	});

	it('breaks a tie in elevation by slug', () => {
		const shown = declutterLabels([label('b', box(0, 0), 4000), label('a', box(10, 0), 4000)]);

		expect(sorted(shown)).toEqual(['a']);
	});

	it('ranks by elevation, not by what showed before', () => {
		const shown = declutterLabels([
			label('lower', box(0, 0), 1000, true),
			label('higher', box(10, 0), 2000, false)
		]);

		expect(sorted(shown)).toEqual(['higher']);
	});

	it('lets a label hidden by a stronger one show when that one is itself hidden', () => {
		const shown = declutterLabels([
			label('top', box(0, 0), 9000),
			label('middle', box(60, 0), 8000),
			label('bottom', box(120, 0), 7000)
		]);

		expect(sorted(shown)).toEqual(['bottom', 'top']);
	});

	it('keeps shown plates apart by the gap, not only by overlap', () => {
		const { gapPixels } = LABEL_DECLUTTER;

		expect(
			sorted(declutterLabels([label('a', box(0, 0), 2, true), label('b', box(80, 0), 1, true)]))
		).toEqual(['a']);
		expect(
			sorted(
				declutterLabels([
					label('a', box(0, 0), 2, true),
					label('b', box(80 + gapPixels, 0), 1, true)
				])
			)
		).toEqual(['a', 'b']);
	});

	it('brings a hidden label back only once it clears its neighbour by the return margin', () => {
		const { gapPixels, returnPixels } = LABEL_DECLUTTER;
		const neighbour = label('kept', box(0, 0), 2, true);
		const at = (left: number, shownBefore: boolean) =>
			declutterLabels([neighbour, label('other', box(left, 0), 1, shownBefore)]).has('other');

		// Inside the band a label keeps the state it had, so a small drift never toggles it.
		for (const left of [80 + gapPixels, 80 + gapPixels + returnPixels / 2]) {
			expect(at(left, true)).toBe(true);
			expect(at(left, false)).toBe(false);
		}
		expect(at(80 + gapPixels + returnPixels, false)).toBe(true);
	});

	it('caps the labels shown', () => {
		const many = Array.from({ length: LABEL_DECLUTTER.maxLabels + 10 }, (_, index) =>
			label(`peak-${String(index).padStart(3, '0')}`, box(index * 200, 0), 5000 - index)
		);

		const shown = declutterLabels(many);

		expect(shown.size).toBe(LABEL_DECLUTTER.maxLabels);
		expect(shown.has('peak-000')).toBe(true);
		expect(shown.has(`peak-${String(LABEL_DECLUTTER.maxLabels).padStart(3, '0')}`)).toBe(false);
	});

	it('decides the same whatever order the labels arrive in', () => {
		const labels = [
			label('everest', box(0, 0), 8849),
			label('lhotse', box(30, 5), 8516),
			label('ama-dablam', box(90, 15), 6814),
			label('makalu', box(200, 0), 8485)
		];

		expect(sorted(declutterLabels([...labels].reverse()))).toEqual(sorted(declutterLabels(labels)));
		expect(sorted(declutterLabels(labels))).toEqual(['ama-dablam', 'everest', 'makalu']);
	});

	it('shows nothing for no candidates', () => {
		expect(declutterLabels([]).size).toBe(0);
	});
});
