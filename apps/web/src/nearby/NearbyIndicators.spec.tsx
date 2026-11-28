import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TestRouter } from '../test/TestRouter';
import { UnitPreferenceProvider } from '../units/UnitPreferenceContext';
import { fixedPreference } from '../units/test-support';
import type { UnitSystem } from '../units/unitSystem';
import type { NearbyMountain } from './findNearbyMountains';
import { NEARBY_INDICATORS_LABEL, NearbyIndicators, sightedSummitsOf } from './NearbyIndicators';
import { SightingFeed } from './SightingFeed';

const EL_PLATA: NearbyMountain = {
	slug: 'cerro-el-plata',
	name: 'Cerro El Plata',
	place: 'Argentina',
	elevationMeters: 5968,
	coordinates: { latitude: -33.015925, longitude: -69.454922 },
	distanceKm: 66
};
const LONG_NAME: NearbyMountain = {
	slug: 'nevado-ojos-del-salado',
	name: 'Nevado Ojos del Salado o Volcán Ojos del Salado',
	place: 'Argentina and Chile',
	elevationMeters: 6893,
	coordinates: { latitude: -27.109, longitude: -68.541 },
	distanceKm: 630
};

function render(mountains: NearbyMountain[], system: UnitSystem = 'metric'): string {
	return renderToStaticMarkup(
		<TestRouter pathname="/mountains/aconcagua">
			<UnitPreferenceProvider value={fixedPreference(system)}>
				<NearbyIndicators mountains={mountains} sightings={new SightingFeed()} />
			</UnitPreferenceProvider>
		</TestRouter>
	);
}

describe('NearbyIndicators', () => {
	it('renders one link per nearby mountain to its permalink, named with its elevation', () => {
		const html = render([EL_PLATA, LONG_NAME]);

		expect(html).not.toContain('role=');
		expect([...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((match) => match[1])).toEqual([
			'/mountains/cerro-el-plata',
			'/mountains/nevado-ojos-del-salado'
		]);
		expect(html).toContain('aria-label="Cerro El Plata, 5,968 m"');
		expect(html).toContain('aria-label="Nevado Ojos del Salado o Volcán Ojos del Salado, 6,893 m"');
	});

	it('words the elevation in the reader’s unit system', () => {
		const html = render([EL_PLATA], 'imperial');

		expect(html).toContain('aria-label="Cerro El Plata, 19,580 ft"');
		expect(html).toContain('>19,580 ft<');
	});

	it('keeps a long name whole in the accessible name; the label itself is cut by style', () => {
		const html = render([LONG_NAME]);

		expect(html).toContain('>Nevado Ojos del Salado o Volcán Ojos del Salado<');
	});

	it('renders every mark unplaced, and no group to announce, until the stage places one', () => {
		const html = render([EL_PLATA, LONG_NAME]);

		expect(html).not.toContain('data-mode');
		expect(html).not.toContain('data-edge');
		expect(html).not.toContain(NEARBY_INDICATORS_LABEL);
		expect(html).not.toContain('style=');
		expect(html.match(/aria-hidden="true"/g)).toHaveLength(2);
	});

	it('renders nothing without nearby mountains', () => {
		expect(render([])).toBe('');
	});

	it('asks the stage to follow the summits of the same mountains, in order', () => {
		expect(sightedSummitsOf([EL_PLATA, LONG_NAME])).toEqual([
			{
				slug: 'cerro-el-plata',
				latitude: -33.015925,
				longitude: -69.454922,
				elevationMeters: 5968
			},
			{
				slug: 'nevado-ojos-del-salado',
				latitude: -27.109,
				longitude: -68.541,
				elevationMeters: 6893
			}
		]);
	});
});
