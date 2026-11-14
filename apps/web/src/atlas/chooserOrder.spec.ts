import { describe, expect, it } from 'vitest';
import type { HitMountain } from '../stage/globe/markerHits';
import { inChooserOrder } from './chooserOrder';

const mountain = (slug: string, name: string, elevationMeters = 3000): HitMountain => ({
	slug,
	name,
	elevationMeters
});

const slugs = (mountains: readonly HitMountain[]) => mountains.map(({ slug }) => slug);

describe('chooser order', () => {
	it('lists mountains alphabetically by name, whatever their height or the order found', () => {
		const found = [
			mountain('mount-everest', 'Mount Everest', 8849),
			mountain('lhotse', 'Lhotse', 8516),
			mountain('makalu', 'Makalu', 8485),
			mountain('cho-oyu', 'Cho Oyu', 8188)
		];

		expect(slugs(inChooserOrder(found))).toEqual(['cho-oyu', 'lhotse', 'makalu', 'mount-everest']);
	});

	it('is the same for every ordering of the same mountains', () => {
		const found = [
			mountain('b', 'Beta'),
			mountain('a', 'Alpha'),
			mountain('c', 'Gamma'),
			mountain('a-2', 'Alpha')
		];

		expect(slugs(inChooserOrder(found))).toEqual(slugs(inChooserOrder([...found].reverse())));
		expect(slugs(inChooserOrder(found))).toEqual(['a', 'a-2', 'b', 'c']);
	});

	it('breaks a tie between equal names by slug', () => {
		const found = [
			mountain('pico-2', 'Pico'),
			mountain('pico-1', 'Pico'),
			mountain('pico', 'Pico')
		];

		expect(slugs(inChooserOrder(found))).toEqual(['pico', 'pico-1', 'pico-2']);
	});

	it('ignores case and accents when comparing names, and uses the slug when that leaves a tie', () => {
		const found = [
			mountain('zeta', 'Zeta'),
			mountain('ecrins-b', 'Écrins'),
			mountain('ecrins-a', 'ecrins'),
			mountain('eiger', 'Eiger')
		];

		expect(slugs(inChooserOrder(found))).toEqual(['ecrins-a', 'ecrins-b', 'eiger', 'zeta']);
	});

	it('does not change the mountains it is given', () => {
		const found = [mountain('b', 'Beta'), mountain('a', 'Alpha')];

		inChooserOrder(found);

		expect(slugs(found)).toEqual(['b', 'a']);
	});

	it('keeps each mountain whole', () => {
		const [first] = inChooserOrder([mountain('a', 'Alpha', 1234)]);

		expect(first).toEqual({ slug: 'a', name: 'Alpha', elevationMeters: 1234 });
	});
});
