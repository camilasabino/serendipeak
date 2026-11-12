import { describe, expect, it } from 'vitest';
import {
	ATLAS_MARKER_STYLE,
	diffMarkers,
	isMarkerVisible,
	markerPresentation,
	sameAtlasMarkers,
	type AtlasMarker
} from './atlasMarkers';

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
			labelShown: true
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

	it('names a marker only within the label distance', () => {
		expect(markerPresentation(style.labelMaxMeters - 1).labelShown).toBe(true);
		expect(markerPresentation(style.labelMaxMeters).labelShown).toBe(false);
	});

	it('keeps every distance threshold in increasing order', () => {
		expect(style.pointNearMeters).toBeLessThan(style.pointFarMeters);
		expect(style.pointOpaqueMeters).toBeLessThan(style.pointFadedMeters);
		expect(style.labelFullMeters).toBeLessThan(style.labelMaxMeters);
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
