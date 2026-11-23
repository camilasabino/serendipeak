import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { MountainInfoPanel } from './MountainInfoPanel';
import { textsOf } from './test-support/markup';

const complete = contractFixture('mountain-complete.json') as Mountain;

function render(overrides: Partial<Mountain>): string {
	return renderToStaticMarkup(<MountainInfoPanel mountain={{ ...complete, ...overrides }} />);
}

describe('MountainInfoPanel', () => {
	it('is a region named by its h1', () => {
		const html = render({});

		expect(html).toMatch(/<section aria-labelledby="mountain-name"[ >]/);
		expect(html).toContain('<h1 id="mountain-name"');
	});

	it('keeps the masthead ahead of the section so a phone can lift it above the stage', () => {
		const html = render({});
		const section = html.indexOf('<section');

		expect(html.indexOf('<h1')).toBeLessThan(section);
		expect(html.indexOf('Elevation')).toBeLessThan(section);
		expect(html.slice(section)).not.toContain('<h1');
		expect(html.match(/<h1/g)).toHaveLength(1);
	});

	it('lists the facts from the most specific place to the least, then the coordinates', () => {
		expect(textsOf(render({}), 'dt')).toEqual(['Region', 'Country', 'Continent', 'Coordinates']);
	});

	it('shows the continent by its name, whatever the countries, even none', () => {
		const continent = { code: 'AF', name: 'Africa' };
		const none = render({ continent, countries: [] });

		expect(textsOf(render({ continent }), 'dd')).toContain('Africa');
		expect(textsOf(none, 'dt')).toEqual(['Region', 'Continent', 'Coordinates']);
		expect(textsOf(none, 'dd')[1]).toBe('Africa');
	});

	it('labels one country as Country and several as Countries', () => {
		const nepal = { code: 'NP', name: 'Nepal' };
		const china = { code: 'CN', name: 'China' };

		expect(textsOf(render({ countries: [nepal] }), 'dt')[1]).toBe('Country');
		expect(textsOf(render({ countries: [nepal, china] }), 'dd')[1]).toBe('Nepal and China');
		expect(textsOf(render({ countries: [nepal, china] }), 'dt')[1]).toBe('Countries');
	});

	it('omits the country row for an empty list', () => {
		expect(textsOf(render({ countries: [] }), 'dt')).toEqual([
			'Region',
			'Continent',
			'Coordinates'
		]);
	});

	describe('Antarctica', () => {
		const antarctica = { code: 'AN', name: 'Antarctica' };
		const sentinel = { slug: 'sentinel-range', name: 'Sentinel Range', ancestors: [] };

		it('shows the continent once when the only country is the continent', () => {
			const html = render({ continent: antarctica, countries: [antarctica], region: sentinel });

			expect(textsOf(html, 'dt')).toEqual(['Region', 'Continent', 'Coordinates']);
			expect(textsOf(html, 'dd').filter((text) => text === 'Antarctica')).toHaveLength(1);
		});

		it('keeps a real country next to the continent', () => {
			const chile = { code: 'CL', name: 'Chile' };
			const html = render({
				continent: antarctica,
				countries: [antarctica, chile],
				region: sentinel
			});

			expect(textsOf(html, 'dt')).toEqual(['Region', 'Country', 'Continent', 'Coordinates']);
			expect(textsOf(html, 'dd').slice(0, 3)).toEqual(['Sentinel Range', 'Chile', 'Antarctica']);
		});
	});

	it('omits the summary and the region when absent', () => {
		const { summary, ...rest } = complete;
		const html = renderToStaticMarkup(
			<MountainInfoPanel mountain={{ ...rest, region: null } as Mountain} />
		);

		expect(summary).toBeDefined();
		expect(complete.region).not.toBeNull();
		expect(textsOf(html, 'p')).not.toContain(summary);
		expect(textsOf(html, 'p')).toHaveLength(2);
		expect(textsOf(html, 'dt')).toEqual(['Country', 'Continent', 'Coordinates']);
	});

	it('shows a root region by its name alone', () => {
		const region = { slug: 'alpha-chain', name: 'Alpha Chain', ancestors: [] };

		expect(textsOf(render({ region }), 'dd')[0]).toBe('Alpha Chain');
	});

	it('shows the whole hierarchy, root first', () => {
		const region = {
			slug: 'gamma-ridge',
			name: 'Gamma Ridge',
			ancestors: [
				{ slug: 'alpha-chain', name: 'Alpha Chain' },
				{ slug: 'beta-range', name: 'Beta Range' }
			]
		};

		expect(textsOf(render({ region }), 'dd')[0]).toBe('Alpha Chain › Beta Range › Gamma Ridge');
	});

	it('places the plate between the place line and the lede, and the action after the facts', () => {
		const html = renderToStaticMarkup(
			<MountainInfoPanel
				mountain={complete}
				plate={<figure>plate</figure>}
				action={<button type="button">act</button>}
			/>
		);
		const order = [
			complete.region?.name ?? '',
			'<figure>',
			complete.summary ?? '',
			'<dl',
			'<button'
		].map((fragment) => html.indexOf(fragment));

		expect(order.every((position) => position > -1)).toBe(true);
		expect(order).toEqual([...order].sort((a, b) => a - b));
	});

	it('speaks the coordinates as a map link', () => {
		expect(render({})).toContain('aria-label="32.6531° S, 70.0120° W on Google Maps"');
	});

	describe('masthead', () => {
		it('orders the name, the elevation, the place and the lede', () => {
			const html = render({});
			const order = ['<h1', 'Elevation', complete.region?.name ?? '', complete.summary ?? ''].map(
				(fragment) => html.indexOf(fragment)
			);

			expect(order.every((position) => position > -1)).toBe(true);
			expect(order).toEqual([...order].sort((a, b) => a - b));
		});

		it('sets the elevation as a grouped figure, named for assistive technology', () => {
			const html = render({ elevationMeters: 6961 });

			expect(textsOf(html, 'p')[0]).toBe('Elevation 6,961 m');
			expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
		});

		it('names the region and the countries on the place line', () => {
			const html = render({
				region: { slug: 'andes', name: 'Andes', ancestors: [] },
				countries: [
					{ code: 'AR', name: 'Argentina' },
					{ code: 'CL', name: 'Chile' }
				]
			});

			expect(textsOf(html, 'p')[1]).toBe('Andes· Argentina and Chile');
		});

		it('keeps the place line concise while the Region fact shows the whole hierarchy', () => {
			const html = render({
				region: {
					slug: 'principal-cordillera',
					name: 'Principal Cordillera',
					ancestors: [
						{ slug: 'andes', name: 'Andes' },
						{ slug: 'southern-andes', name: 'Southern Andes' }
					]
				},
				countries: [{ code: 'AR', name: 'Argentina' }]
			});

			expect(textsOf(html, 'p')[1]).toBe('Principal Cordillera· Argentina');
			expect(textsOf(html, 'dd')[0]).toBe('Andes › Southern Andes › Principal Cordillera');
		});

		it('keeps a place line without a region or a summary', () => {
			const { summary, ...rest } = complete;
			const html = renderToStaticMarkup(
				<MountainInfoPanel mountain={{ ...rest, region: null } as Mountain} />
			);

			expect(summary).toBeDefined();
			expect(textsOf(html, 'p')[1]).toBe(complete.countries.map(({ name }) => name).join(', '));
		});

		it('hides the separators from assistive technology', () => {
			expect(render({})).toContain('aria-hidden="true">·</span>');
		});
	});
});
