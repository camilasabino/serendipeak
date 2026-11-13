import { describe, expect, it } from 'vitest';
import { MARKER_HIT, markersInReach, resolveMarkerHit, type HitTarget } from './markerHits';

function target(
	slug: string,
	x: number,
	y: number,
	elevationMeters = 3000,
	label?: HitTarget['label']
): HitTarget {
	return { slug, name: slug.toUpperCase(), elevationMeters, x, y, label };
}

const slugsOf = (hit: ReturnType<typeof resolveMarkerHit>) => {
	switch (hit.kind) {
		case 'mountain':
			return [hit.mountain.slug];
		case 'choice':
			return hit.mountains.map((mountain) => mountain.slug);
		default:
			return [];
	}
};

describe('marker hit tolerances', () => {
	const lone = [target('lone', 100, 100)];

	it.each([
		['fine', MARKER_HIT.fine.radiusPixels],
		['coarse', MARKER_HIT.coarse.radiusPixels]
	] as const)('a %s press reaches a marker up to %i px from its centre', (precision, radius) => {
		expect(resolveMarkerHit(lone, { x: 100 + radius, y: 100 }, precision)).toEqual({
			kind: 'mountain',
			mountain: { slug: 'lone', name: 'LONE' }
		});
		expect(resolveMarkerHit(lone, { x: 100 + radius + 0.5, y: 100 }, precision).kind).toBe('none');
	});

	it('gives a finger a wider reach than a mouse', () => {
		const pointer = { x: 100, y: 118 };

		expect(resolveMarkerHit(lone, pointer, 'fine').kind).toBe('none');
		expect(resolveMarkerHit(lone, pointer, 'coarse').kind).toBe('mountain');
	});

	it('measures reach in both axes, not along one', () => {
		expect(resolveMarkerHit(lone, { x: 109, y: 109 }, 'fine').kind).toBe('none');
		expect(resolveMarkerHit(lone, { x: 108, y: 108 }, 'fine').kind).toBe('mountain');
	});

	it('hits nothing on an empty globe', () => {
		expect(resolveMarkerHit([], { x: 0, y: 0 }, 'coarse')).toEqual({ kind: 'none' });
	});
});

describe('nearest marker selection', () => {
	it('opens the nearer of two markers in reach when the other is clearly farther', () => {
		const targets = [target('a', 100, 100), target('b', 110, 100)];

		expect(slugsOf(resolveMarkerHit(targets, { x: 101, y: 100 }, 'fine'))).toEqual(['a']);
		expect(slugsOf(resolveMarkerHit(targets, { x: 109, y: 100 }, 'fine'))).toEqual(['b']);
	});

	it('lets a press right on one of two touching dots open that one', () => {
		const targets = [target('a', 100, 100), target('b', 106, 100)];

		expect(slugsOf(resolveMarkerHit(targets, { x: 100, y: 100 }, 'fine'))).toEqual(['a']);
		expect(slugsOf(resolveMarkerHit(targets, { x: 106, y: 100 }, 'fine'))).toEqual(['b']);
	});

	it('counts a press on a shown label as a press on its mountain', () => {
		const label = { left: 60, top: 70, right: 140, bottom: 93 };
		const targets = [target('named', 100, 100, 3000, label), target('other', 150, 85)];

		expect(slugsOf(resolveMarkerHit(targets, { x: 135, y: 80 }, 'fine'))).toEqual(['named']);
	});

	it('does not count the place of a hidden label', () => {
		const targets = [target('unnamed', 100, 100)];

		expect(resolveMarkerHit(targets, { x: 130, y: 80 }, 'fine').kind).toBe('none');
	});
});

describe('ambiguous hits', () => {
	it('asks when two dots merge on screen', () => {
		const targets = [target('a', 100, 100), target('b', 101.5, 100.5)];

		expect(resolveMarkerHit(targets, { x: 100.5, y: 100 }, 'fine').kind).toBe('choice');
	});

	it('asks for a press halfway between two markers, and not for one beside either', () => {
		const targets = [target('a', 100, 100), target('b', 116, 100)];

		expect(resolveMarkerHit(targets, { x: 108, y: 100 }, 'coarse').kind).toBe('choice');
		expect(slugsOf(resolveMarkerHit(targets, { x: 100, y: 100 }, 'coarse'))).toEqual(['a']);
		expect(slugsOf(resolveMarkerHit(targets, { x: 116, y: 100 }, 'coarse'))).toEqual(['b']);
	});

	it('draws the line at the clearance: just under asks, exactly at it opens the nearest', () => {
		const { clearancePixels } = MARKER_HIT.fine;
		const near = target('near', 100, 100);

		expect(
			resolveMarkerHit([near, target('far', 100 + clearancePixels - 0.5, 100)], near, 'fine').kind
		).toBe('choice');
		expect(
			slugsOf(resolveMarkerHit([near, target('far', 100 + clearancePixels, 100)], near, 'fine'))
		).toEqual(['near']);
	});

	it('is more forgiving for a finger, whose press wobbles more', () => {
		const targets = [target('a', 100, 100), target('b', 106, 100)];

		expect(resolveMarkerHit(targets, { x: 100, y: 100 }, 'fine').kind).toBe('mountain');
		expect(resolveMarkerHit(targets, { x: 100, y: 100 }, 'coarse').kind).toBe('choice');
	});

	it('offers only the contenders, not every marker in reach', () => {
		const targets = [target('a', 100, 100), target('b', 102, 100), target('c', 110, 100)];

		expect(slugsOf(resolveMarkerHit(targets, { x: 101, y: 100 }, 'fine'))).toEqual(['a', 'b']);
	});

	it('measures the clearance from the exact nearest distance, whoever wins the elevation tie', () => {
		// a and b round to the same pixel, so elevation orders them; c is clear of b but not of a.
		const place = (aElevation: number, bElevation: number) => [
			target('a', 108.4, 100, aElevation),
			target('b', 92.4, 100, bElevation),
			target('c', 100, 111.7, 2000)
		];
		const pointer = { x: 100, y: 100 };

		const aHigher = slugsOf(resolveMarkerHit(place(5000, 4000), pointer, 'fine'));
		const bHigher = slugsOf(resolveMarkerHit(place(4000, 5000), pointer, 'fine'));

		expect([...aHigher].sort()).toEqual(['a', 'b']);
		expect([...bHigher].sort()).toEqual(['a', 'b']);
		expect(aHigher).toEqual(['a', 'b']);
		expect(bHigher).toEqual(['b', 'a']);
	});

	it('asks when a dot sits under the press on another mountain’s label', () => {
		const label = { left: 60, top: 70, right: 140, bottom: 93 };
		const targets = [target('named', 100, 100, 3000, label), target('covered', 120, 80)];

		expect(slugsOf(resolveMarkerHit(targets, { x: 121, y: 80 }, 'fine'))).toEqual([
			'named',
			'covered'
		]);
	});
});

describe('candidate order', () => {
	it('puts the nearest first', () => {
		const targets = [target('far', 110, 100), target('near', 103, 100), target('mid', 106, 100)];

		expect(
			markersInReach(targets, { x: 100, y: 100 }, 12).map(({ target }) => target.slug)
		).toEqual(['near', 'mid', 'far']);
	});

	it('breaks a tie in distance by the higher summit, then by slug', () => {
		const targets = [
			target('b-low', 100, 104, 1000),
			target('c-high', 104, 100, 5000),
			target('a-low', 96, 100, 1000)
		];

		expect(
			markersInReach(targets, { x: 100, y: 100 }, 12).map(({ target }) => target.slug)
		).toEqual(['c-high', 'a-low', 'b-low']);
	});

	it('treats distances within the same whole pixel as a tie', () => {
		const targets = [target('lower', 100.2, 100, 1000), target('higher', 100.4, 100, 8000)];

		expect(
			markersInReach(targets, { x: 100, y: 100 }, 12).map(({ target }) => target.slug)
		).toEqual(['higher', 'lower']);
	});

	it('orders the same way whatever order the markers arrive in', () => {
		const targets = [
			target('everest', 100, 100, 8849),
			target('ama-dablam', 100.4, 100.3, 6814),
			target('lhotse', 100.3, 100.4, 8516)
		];
		const forwards = resolveMarkerHit(targets, { x: 100, y: 100 }, 'fine');
		const backwards = resolveMarkerHit([...targets].reverse(), { x: 100, y: 100 }, 'fine');

		expect(slugsOf(forwards)).toEqual(['everest', 'lhotse', 'ama-dablam']);
		expect(backwards).toEqual(forwards);
	});
});
