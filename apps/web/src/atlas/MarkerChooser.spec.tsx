import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TestRouter } from '../test/TestRouter';
import { MarkerChooser } from './MarkerChooser';
import type { MarkerChoice } from './useMarkerActivation';

const CHOICE: MarkerChoice = {
	kind: 'choice',
	mountains: [
		{ slug: 'fitz-roy', name: 'Fitz Roy', elevationMeters: 3405 },
		{ slug: 'cerro-torre', name: 'Cerro Torre', elevationMeters: 3128 }
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

function links(html: string) {
	return [
		...html.matchAll(
			/<a [^>]*href="([^"]+)"[^>]*><span[^>]*>([^<]+)<\/span> <span[^>]*>([^<]+)<\/span><\/a>/g
		)
	].map(([, href, name, elevation]) => ({ href, name, elevation }));
}

describe('MarkerChooser', () => {
	it('is a dialog named by its visible title', () => {
		const html = render();
		const [, labelledBy] = /role="dialog" aria-labelledby="([^"]+)"/.exec(html) ?? [];

		expect(labelledBy).toBeDefined();
		expect(html).toContain(`id="${labelledBy}"`);
		expect(html).toContain('Which mountain?');
	});

	it('links each mountain to its canonical page, alphabetically however the press ranked them', () => {
		expect(links(render())).toEqual([
			{ href: '/mountains/cerro-torre', name: 'Cerro Torre', elevation: '3,128 m' },
			{ href: '/mountains/fitz-roy', name: 'Fitz Roy', elevation: '3,405 m' }
		]);
	});

	it('lists mountains with equal names by slug', () => {
		const html = render({
			...CHOICE,
			mountains: [
				{ slug: 'pico-b', name: 'Pico', elevationMeters: 2000 },
				{ slug: 'pico-a', name: 'Pico', elevationMeters: 3000 },
				{ slug: 'aneto', name: 'Aneto', elevationMeters: 3404 }
			]
		});

		expect(links(html).map(({ href }) => href)).toEqual([
			'/mountains/aneto',
			'/mountains/pico-a',
			'/mountains/pico-b'
		]);
	});

	it('shows the elevation with the shared format, secondary to the name', () => {
		const html = render({
			...CHOICE,
			mountains: [
				{ slug: 'everest', name: 'Mount Everest', elevationMeters: 8848.86 },
				{ slug: 'hill', name: 'Hill', elevationMeters: 852 }
			]
		});

		expect(links(html).map(({ elevation }) => elevation)).toEqual(['852 m', '8,849 m']);
		expect(html).toMatch(/<span class="[^"]*elevation[^"]*">852 m<\/span>/);
	});

	it('lets a screen reader hear the name and the elevation apart, in one link', () => {
		const html = render();

		// The link's accessible name is its text, so the two spans need a space between them.
		expect(html).toMatch(/>Cerro Torre<\/span> <span[^>]*>3,128 m<\/span><\/a>/);
		expect(html).not.toContain('aria-label="Cerro');
		expect(html).not.toMatch(/<a [^>]*aria-hidden/);
	});

	it('keeps a long name whole in the DOM, for the stylesheet to wrap', () => {
		const name = 'Nevado Ojos del Salado Oriental con un nombre excesivamente largo';
		const html = render({
			...CHOICE,
			mountains: [{ slug: 'long', name, elevationMeters: 6893 }, CHOICE.mountains[0]!]
		});

		expect(html).toContain(`>${name}</span>`);
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
			mountains: [{ slug: 'a b', name: 'A', elevationMeters: 1000 }, CHOICE.mountains[0]!]
		});

		expect(html).toContain('href="/mountains/a%20b"');
	});
});
