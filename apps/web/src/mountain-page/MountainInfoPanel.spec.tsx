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

	it('labels one country as Country and several as Countries', () => {
		expect(textsOf(render({ countries: ['Nepal'] }), 'dt')[0]).toBe('Country');
		expect(textsOf(render({ countries: ['Nepal', 'China'] }), 'dd')[0]).toBe('Nepal and China');
		expect(textsOf(render({ countries: ['Nepal', 'China'] }), 'dt')[0]).toBe('Countries');
	});

	it('omits the country row for an empty list', () => {
		expect(textsOf(render({ countries: [] }), 'dt')).toEqual(['Elevation', 'Range', 'Coordinates']);
	});

	it('omits the summary and the range when absent', () => {
		const { summary, rangeName, ...rest } = complete;
		const html = renderToStaticMarkup(<MountainInfoPanel mountain={rest as Mountain} />);

		expect(summary).toBeDefined();
		expect(rangeName).toBeDefined();
		expect(html).not.toContain('<p');
		expect(textsOf(html, 'dt')).toEqual(['Country', 'Elevation', 'Coordinates']);
	});

	it('speaks the coordinates as a map link', () => {
		expect(render({})).toContain('aria-label="32.6531° S, 70.0120° W on Google Maps"');
	});
});
