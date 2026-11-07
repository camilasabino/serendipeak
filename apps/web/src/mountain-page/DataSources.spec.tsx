import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DataSources } from './DataSources';
import { anchorsOf, textsOf } from './test-support/markup';

const OSM = 'https://www.openstreetmap.org/node/1';
const WIKIDATA = 'https://www.wikidata.org/wiki/Q1';

function render(sources: Parameters<typeof DataSources>[0]['sources']): string {
	return renderToStaticMarkup(<DataSources sources={sources} />);
}

describe('DataSources', () => {
	it('lists both sources in a disclosure', () => {
		const html = render({ osm: OSM, wikidata: WIKIDATA });

		expect(textsOf(html, 'summary')).toEqual(['Data sources']);
		expect(anchorsOf(html).map(({ text, href }) => [text, href])).toEqual([
			['© OpenStreetMap contributors', OSM],
			['Wikidata', WIKIDATA]
		]);
	});

	it.each([
		['OpenStreetMap', { osm: OSM }, '© OpenStreetMap contributors'],
		['Wikidata', { wikidata: WIKIDATA }, 'Wikidata']
	])('lists only %s when it is the only source', (_name, sources, label) => {
		expect(textsOf(render(sources), 'li')).toEqual([label]);
	});

	it.each([
		['absent sources', undefined],
		['empty sources', {}]
	])('renders nothing for %s', (_name, sources) => {
		expect(render(sources)).toBe('');
	});
});
