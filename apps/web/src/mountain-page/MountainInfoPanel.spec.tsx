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

		expect(html).toContain('<section aria-labelledby="mountain-name">');
		expect(html).toContain('<h1 id="mountain-name"');
	});

	it('shows the continent first, by its name', () => {
		const continent = { code: 'AF', name: 'Africa' };

		expect(textsOf(render({ continent }), 'dt')[0]).toBe('Continent');
		expect(textsOf(render({ continent }), 'dd')[0]).toBe('Africa');
	});

	it('shows the continent whatever the countries, even none', () => {
		const html = render({ continent: { code: 'AN', name: 'Antarctica' }, countries: [] });

		expect(textsOf(html, 'dd')[0]).toBe('Antarctica');
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
			'Continent',
			'Elevation',
			'Range',
			'Coordinates'
		]);
	});

	it('omits the summary and the range when absent', () => {
		const { summary, rangeName, ...rest } = complete;
		const html = renderToStaticMarkup(<MountainInfoPanel mountain={rest as Mountain} />);

		expect(summary).toBeDefined();
		expect(rangeName).toBeDefined();
		expect(html).not.toContain('<p');
		expect(textsOf(html, 'dt')).toEqual(['Continent', 'Country', 'Elevation', 'Coordinates']);
	});

	it('speaks the coordinates as a map link', () => {
		expect(render({})).toContain('aria-label="32.6531° S, 70.0120° W on Google Maps"');
	});
});
