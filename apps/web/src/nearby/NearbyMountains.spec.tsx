import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TestRouter } from '../test/TestRouter';
import { UnitPreferenceProvider } from '../units/UnitPreferenceContext';
import { fixedPreference } from '../units/test-support';
import type { UnitSystem } from '../units/unitSystem';
import { anchorsOf, countOf, hasEmptyElement, textsOf } from '../mountain-page/test-support/markup';
import type { NearbyMountain } from './findNearbyMountains';
import { NearbyMountains } from './NearbyMountains';

const FITZ_ROY: NearbyMountain = {
	slug: 'fitz-roy',
	name: 'Fitz Roy',
	place: 'Argentina and Chile',
	elevationMeters: 3405,
	coordinates: { latitude: -49.271, longitude: -73.043 },
	distanceKm: 4.6
};
const TORRE: NearbyMountain = {
	slug: 'cerro-torre',
	name: 'Cerro Torre',
	place: 'Chile',
	elevationMeters: 3128,
	coordinates: { latitude: -49.293, longitude: -73.098 },
	distanceKm: 122
};

function render(mountains: NearbyMountain[], system?: UnitSystem): string {
	const content: ReactNode = <NearbyMountains mountains={mountains} />;

	return renderToStaticMarkup(
		<TestRouter pathname="/mountains/aconcagua">
			<UnitPreferenceProvider value={system ? fixedPreference(system) : undefined}>
				{content}
			</UnitPreferenceProvider>
		</TestRouter>
	);
}

describe('NearbyMountains', () => {
	it('renders nothing, not even a heading, when there are none', () => {
		expect(render([])).toBe('');
	});

	it('is a section named by its own heading, with one list item per mountain', () => {
		const html = render([FITZ_ROY, TORRE]);
		const [, labelledBy] = /<section aria-labelledby="([^"]+)"/.exec(html) ?? [];

		expect(textsOf(html, 'h2')).toEqual(['Nearby mountains']);
		expect(labelledBy).toBeDefined();
		expect(html).toContain(`<h2 id="${labelledBy}"`);
		expect(countOf(html, 'li')).toBe(2);
		expect(countOf(html, 'h1')).toBe(0);
	});

	it('links each mountain to its canonical permalink, in the given order', () => {
		const links = anchorsOf(render([FITZ_ROY, TORRE]));

		expect(links.map(({ href }) => href)).toEqual([
			'/mountains/fitz-roy',
			'/mountains/cerro-torre'
		]);
		for (const { attributes } of links) {
			expect(attributes).not.toContain('target=');
		}
	});

	it('shows the name, then place and elevation, then the approximate distance', () => {
		const [link] = anchorsOf(render([FITZ_ROY]));

		expect(link?.text).toBe('Fitz RoyArgentina and Chile · 3,405 m≈ 5 kmabout 5 kilometers away');
	});

	it('hides the symbol from assistive technology and says the distance in words', () => {
		const html = render([TORRE]);

		expect(html).toMatch(/<span aria-hidden="true">≈ 120 km<\/span>/);
		expect(html).toContain('about 120 kilometers away');
	});

	it('follows the imperial system for elevation and distance', () => {
		const [link] = anchorsOf(render([FITZ_ROY], 'imperial'));

		expect(link?.text).toContain('11,171 ft');
		expect(link?.text).toContain('≈ 3 mi');
		expect(link?.text).toContain('about 3 miles away');
		expect(link?.text).not.toMatch(/\bkm\b|kilometers|\d m\b/);
	});

	it('leaves no empty element or placeholder text', () => {
		const html = render([FITZ_ROY, TORRE]);

		expect(hasEmptyElement(html)).toBe(false);
		expect(html).not.toMatch(/undefined|null|NaN/);
		expect(html).not.toContain('aria-live');
	});
});
