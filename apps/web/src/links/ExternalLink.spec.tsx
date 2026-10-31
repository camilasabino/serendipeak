import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ExternalLink } from './ExternalLink';

describe('ExternalLink', () => {
	it('opens in a new tab without leaking the opener or the referrer context', () => {
		const html = renderToStaticMarkup(
			<ExternalLink href="https://example.org/a" aria-label="Example">
				Example
			</ExternalLink>
		);

		expect(html).toBe(
			'<a href="https://example.org/a" aria-label="Example" target="_blank" rel="external noopener noreferrer">Example</a>'
		);
	});
});
