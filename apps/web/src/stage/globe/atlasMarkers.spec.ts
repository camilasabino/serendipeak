import { describe, expect, it } from 'vitest';
import {
	ATLAS_MARKER_STYLE,
	diffMarkers,
	isMarkerVisible,
	labelOpacityStep,
	markerPresentation,
	placePreview,
	sameAtlasMarkers,
	type AtlasMarker
} from './atlasMarkers';
import { MARKER_HIT } from './markerHits';

const VIEWPORT = { width: 800, height: 600 };

function marker(slug: string, overrides: Partial<AtlasMarker> = {}): AtlasMarker {
	return { slug, name: slug, latitude: 45, longitude: 7, elevationMeters: 4000, ...overrides };
}

describe('isMarkerVisible', () => {
	const sighted = { inFront: true, aboveHorizon: true, window: { x: 400, y: 300 } };

	it('shows a marker in front of the camera, above the horizon and inside the canvas', () => {
		expect(isMarkerVisible(sighted, VIEWPORT)).toBe(true);
	});

	it('hides a marker behind the horizon even when it projects inside the canvas', () => {
		expect(isMarkerVisible({ ...sighted, aboveHorizon: false }, VIEWPORT)).toBe(false);
	});

	it('hides a marker behind the camera even when it projects inside the canvas', () => {
		expect(isMarkerVisible({ ...sighted, inFront: false }, VIEWPORT)).toBe(false);
	});

	it('hides a marker that cannot be projected', () => {
		expect(isMarkerVisible({ ...sighted, window: undefined }, VIEWPORT)).toBe(false);
	});

	it.each([
		[-0.5, 300],
		[800.5, 300],
		[400, -0.5],
		[400, 600.5],
		[Number.NaN, 300]
	])('hides a marker projected outside the canvas at (%d, %d)', (x, y) => {
		expect(isMarkerVisible({ ...sighted, window: { x, y } }, VIEWPORT)).toBe(false);
	});

	it.each([
		[0, 0],
		[800, 600]
	])('keeps a marker exactly on the canvas edge at (%d, %d)', (x, y) => {
		expect(isMarkerVisible({ ...sighted, window: { x, y } }, VIEWPORT)).toBe(true);
	});

	it('shows nothing on a canvas without size', () => {
		expect(isMarkerVisible(sighted, { width: 0, height: 0 })).toBe(false);
	});
});

describe('markerPresentation', () => {
	const style = ATLAS_MARKER_STYLE;

	it('draws full-size opaque points with a label up close', () => {
		expect(markerPresentation(100_000)).toEqual({
			pointPixels: style.pointPixelSize,
			pointAlpha: 1,
			labelAlpha: 1,
			labelShown: true,
			labelFading: false
		});
	});

	it('draws small, slightly translucent points and no label from the global overview', () => {
		const overview = markerPresentation(14_000_000);

		expect(overview.pointPixels).toBeCloseTo(style.pointPixelSize * style.pointFarScale);
		expect(overview.pointAlpha).toBeLessThan(1);
		expect(overview.pointAlpha).toBeGreaterThanOrEqual(style.pointFarAlpha);
		expect(overview.labelShown).toBe(false);
	});

	it('shrinks the point steadily between its near and far distances', () => {
		const sizes = [250_000, 1_000_000, 4_000_000, 8_000_000, 20_000_000].map(
			(distance) => markerPresentation(distance).pointPixels
		);

		expect(sizes).toEqual([...sizes].sort((a, b) => b - a));
		expect(sizes.at(-1)).toBeCloseTo(sizes.at(-2)!);
	});

	it('fades a label to nothing between its full and maximum distance', () => {
		expect(markerPresentation(style.labelFullMeters).labelAlpha).toBe(1);
		expect(markerPresentation(style.labelMaxMeters).labelAlpha).toBe(0);
		const midway = (style.labelFullMeters + style.labelMaxMeters) / 2;
		expect(markerPresentation(midway).labelAlpha).toBeCloseTo(0.5);
	});

	it('names a marker only while its label is legible, not as it fades to nothing', () => {
		const readableMeters =
			style.labelFullMeters +
			(1 - style.labelMinAlpha) * (style.labelMaxMeters - style.labelFullMeters);

		expect(markerPresentation(readableMeters - 1).labelShown).toBe(true);
		expect(markerPresentation(readableMeters + 1).labelShown).toBe(false);
		expect(markerPresentation(style.labelMaxMeters - 1).labelShown).toBe(false);
		expect(markerPresentation(style.labelMaxMeters).labelShown).toBe(false);
	});

	it('rounds a label opacity to the step it is handed to Cesium in', () => {
		const step = 1 / style.labelAlphaSteps;

		expect(labelOpacityStep(1)).toBe(1);
		expect(labelOpacityStep(0.5)).toBe(0.5);
		expect(labelOpacityStep(0.5 + step * 0.4)).toBeCloseTo(0.5);
		expect(labelOpacityStep(0.5 + step * 0.6)).toBeCloseTo(0.5 + step);
	});

	it('fades a label out over a short stretch, nowhere near a tenth of the distance', () => {
		const ramp = style.labelMaxMeters - style.labelFullMeters;

		expect(ramp / style.labelFullMeters).toBeLessThan(0.1);
	});

	it('marks a label fading once past full legibility', () => {
		expect(markerPresentation(style.labelFullMeters).labelFading).toBe(false);
		expect(markerPresentation(style.labelFullMeters + 1).labelFading).toBe(true);
	});

	it('keeps every distance threshold in increasing order', () => {
		expect(style.pointNearMeters).toBeLessThan(style.pointFarMeters);
		expect(style.pointOpaqueMeters).toBeLessThan(style.pointFadedMeters);
		expect(style.labelFullMeters).toBeLessThan(style.labelMaxMeters);
		expect(style.labelMinAlpha).toBeGreaterThan(0);
		expect(style.labelMinAlpha).toBeLessThan(1);
		expect(style.labelMaxMeters).toBeLessThan(style.pointFarMeters);
	});
});

describe('diffMarkers', () => {
	it('adds every marker to an empty layer', () => {
		const next = [marker('a'), marker('b')];

		expect(diffMarkers([], next)).toEqual({ added: next, changed: [], removed: [] });
	});

	it('changes nothing for the same markers', () => {
		expect(diffMarkers([marker('a')], [marker('a')])).toEqual({
			added: [],
			changed: [],
			removed: []
		});
	});

	it('adds new slugs, changes edited ones and removes the ones that left', () => {
		const renamed = marker('b', { name: 'Renamed' });
		const moved = marker('c', { latitude: 46 });

		expect(
			diffMarkers(
				[marker('a'), marker('b'), marker('c'), marker('d')],
				[renamed, moved, marker('d'), marker('e')]
			)
		).toEqual({ added: [marker('e')], changed: [renamed, moved], removed: ['a'] });
	});

	it('treats an elevation edit as a change', () => {
		const raised = marker('a', { elevationMeters: 4001 });

		expect(diffMarkers([marker('a')], [raised]).changed).toEqual([raised]);
	});

	it('removes everything for an empty index', () => {
		expect(diffMarkers([marker('a'), marker('b')], []).removed).toEqual(['a', 'b']);
	});

	it('keeps the first entry of a slug listed twice', () => {
		const first = marker('a');

		expect(diffMarkers([], [first, marker('a', { name: 'Again' })]).added).toEqual([first]);
	});
});

describe('sameAtlasMarkers', () => {
	it('is true for equal content in new arrays', () => {
		expect(sameAtlasMarkers([marker('a')], [marker('a')])).toBe(true);
	});

	it.each([
		['a different length', [marker('a'), marker('b')]],
		['a different order', [marker('b'), marker('a')].slice(0, 1)],
		['an edited marker', [marker('a', { longitude: 8 })]]
	])('is false for %s', (_case, other) => {
		expect(sameAtlasMarkers([marker('a')], other)).toBe(false);
	});

	it('tells no markers from an empty set', () => {
		expect(sameAtlasMarkers(undefined, undefined)).toBe(true);
		expect(sameAtlasMarkers(undefined, [])).toBe(false);
	});
});

describe('atlas dot', () => {
	it('is the size the scene scales with distance: disc, ring and halo across', () => {
		const { dot, pointPixelSize } = ATLAS_MARKER_STYLE;

		expect(pointPixelSize).toBeCloseTo((dot.radius + dot.ringWidth + dot.haloWidth) * 2, 10);
		expect(markerPresentation(0).pointPixels).toBe(pointPixelSize);
	});

	it('stays inside the reach of a press', () => {
		const { dot } = ATLAS_MARKER_STYLE;
		const glow = dot.radius * dot.emphasizedScale + dot.ringWidth + dot.haloWidth + dot.glowWidth;

		expect(glow).toBeLessThan(MARKER_HIT.fine.radiusPixels);
	});
});

describe('placePreview', () => {
	const room = { bounds: { width: 800, height: 600 }, sideInsetPixels: 60 };
	const pill = { width: 140, height: 42 };
	const { gapPixels, edgeMarginPixels } = ATLAS_MARKER_STYLE.preview;
	const radius = 8;

	it('centres the pill over the dot, its bottom a gap above the dot', () => {
		const { box, offset } = placePreview({ x: 400, y: 300 }, pill, radius, room);

		expect(box).toEqual({
			left: 330,
			right: 470,
			top: 300 - radius - gapPixels - 42,
			bottom: 300 - radius - gapPixels
		});
		expect(offset).toEqual({ x: 0, y: box.bottom - 300 });
	});

	it('slides sideways to clear the control columns, and back from the far edge', () => {
		const left = placePreview({ x: 10, y: 300 }, pill, radius, room);
		const right = placePreview({ x: 795, y: 300 }, pill, radius, room);

		expect(left.box.left).toBe(60);
		expect(left.offset.x).toBe(60 + 70 - 10);
		expect(right.box.right).toBe(740);
		expect(right.offset.x).toBe(740 - 70 - 795);
	});

	it('goes below the dot where there is no room above it', () => {
		const { box } = placePreview({ x: 400, y: 30 }, pill, radius, room);

		expect(box.top).toBe(30 + radius + gapPixels);
		expect(box.bottom).toBe(box.top + 42);
	});

	it('keeps the edge margin when it fits above, and moves below when it only just does not', () => {
		const exactly = edgeMarginPixels + 42 + radius + gapPixels;

		expect(placePreview({ x: 400, y: exactly }, pill, radius, room).box.top).toBe(edgeMarginPixels);
		expect(placePreview({ x: 400, y: exactly - 1 }, pill, radius, room).box.top).toBeGreaterThan(
			exactly - 1
		);
	});

	it('falls back to the edge margin when the pill is wider than the room between the columns', () => {
		const wide = { width: 300, height: 42 };
		const narrow = { bounds: { width: 320, height: 400 }, sideInsetPixels: 60 };

		const { box } = placePreview({ x: 10, y: 200 }, wide, radius, narrow);

		expect(box.left).toBe(edgeMarginPixels);
		expect(box.right).toBeLessThanOrEqual(320);
	});

	it('never puts the pill outside a stage it cannot fit in, but keeps its left edge inside', () => {
		const { box } = placePreview({ x: 100, y: 100 }, { width: 500, height: 42 }, radius, {
			bounds: { width: 300, height: 300 },
			sideInsetPixels: 60
		});

		expect(box.left).toBe(edgeMarginPixels);
	});
});
