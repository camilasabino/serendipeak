import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { websiteJsonLd, websiteStructuredData } from './websiteStructuredData';

describe('websiteStructuredData', () => {
	it('describes the site with only its name and configured URL', () => {
		expect(JSON.parse(websiteJsonLd('https://serendipeak.example'))).toEqual({
			'@context': 'https://schema.org',
			'@type': 'WebSite',
			name: 'SerendiPeak',
			url: 'https://serendipeak.example/'
		});
	});

	it('renders one JSON-LD script', () => {
		const html = renderToStaticMarkup(websiteStructuredData('https://serendipeak.example'));

		expect(html.match(/<script type="application\/ld\+json">/g)).toHaveLength(1);
	});

	it('publishes nothing without a configured origin', () => {
		expect(websiteStructuredData(null)).toBeNull();
	});
});
