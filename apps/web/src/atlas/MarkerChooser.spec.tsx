import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TestRouter } from '../test/TestRouter';
import { MarkerChooser } from './MarkerChooser';
import type { MarkerChoice } from './useMarkerActivation';

const CHOICE: MarkerChoice = {
	kind: 'choice',
	mountains: [
		{ slug: 'fitz-roy', name: 'Fitz Roy' },
		{ slug: 'cerro-torre', name: 'Cerro Torre' }
	],
	at: { x: 120, y: 80 }
};

function render(choice: MarkerChoice = CHOICE): string {
	return renderToStaticMarkup(
		<TestRouter pathname="/atlas">
			<MarkerChooser choice={choice} onClose={() => {}} />
		</TestRouter>
	);
}

describe('MarkerChooser', () => {
	it('is a dialog named by its visible title', () => {
		const html = render();
		const [, labelledBy] = /role="dialog" aria-labelledby="([^"]+)"/.exec(html) ?? [];

		expect(labelledBy).toBeDefined();
		expect(html).toContain(`id="${labelledBy}"`);
		expect(html).toContain('Which mountain?');
	});

	it('links each mountain to its canonical page, in the order given', () => {
		const html = render();
		const links = [...html.matchAll(/<a [^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(
			([, href, name]) => [href, name]
		);

		expect(links).toEqual([
			['/mountains/fitz-roy', 'Fitz Roy'],
			['/mountains/cerro-torre', 'Cerro Torre']
		]);
	});

	it('offers a labelled close button for readers without an Escape key', () => {
		expect(render()).toMatch(/<button type="button"[^>]*aria-label="Close the list of mountains"/);
	});

	it('stays hidden at the point pressed until it has been measured and placed', () => {
		expect(render()).toMatch(/style="left:120px;top:80px;visibility:hidden"/);
	});

	it('escapes the slug in each link', () => {
		const html = render({
			...CHOICE,
			mountains: [{ slug: 'a b', name: 'A' }, CHOICE.mountains[0]!]
		});

		expect(html).toContain('href="/mountains/a%20b"');
	});
});
