import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { prepareIndex } from './findMountains';
import type { MountainIndexState } from './MountainIndexStore';
import { SearchButton } from './SearchControl';
import { SearchCombobox } from './SearchDialog';
import { indexEntry } from './test-support/indexEntries';

const noop = () => {};

const READY: MountainIndexState = {
	status: 'ready',
	index: prepareIndex([
		indexEntry('aconcagua', 'Aconcagua', {
			countries: [
				{ code: 'AR', name: 'Argentina' },
				{ code: 'CL', name: 'Chile' }
			],
			elevationMeters: 6961
		}),
		indexEntry('monch', 'Mönch', { elevationMeters: 4110 }),
		indexEntry('mont-blanc', 'Mont Blanc', { elevationMeters: 4806 })
	])
};

function render(state: MountainIndexState, initialQuery = ''): string {
	return renderToStaticMarkup(
		<SearchCombobox state={state} onSelect={noop} onRetry={noop} initialQuery={initialQuery} />
	);
}

function inputOf(html: string): string {
	return html.match(/<input[^>]*>/)?.[0] ?? '';
}

function statusOf(html: string): string {
	return html.match(/<p[^>]*role="status"[^>]*>([^<]*)<\/p>/)?.[1] ?? '';
}

describe('SearchButton', () => {
	it('is a native button named for what it opens, with a decorative icon', () => {
		const html = renderToStaticMarkup(<SearchButton onOpen={noop} />);

		expect(html).toMatch(/^<button type="button"/);
		expect(html).toContain('aria-haspopup="dialog"');
		expect(html.replace(/<[^>]+>/g, '')).toBe('Search mountains');
		expect(html).toMatch(/<svg[^>]*aria-hidden="true"/);
	});
});

describe('SearchCombobox', () => {
	it('labels a combobox that controls no list while nothing is typed', () => {
		const html = render(READY);
		const input = inputOf(html);
		const id = input.match(/id="([^"]+)"/)?.[1];

		expect(html).toMatch(new RegExp(`<label[^>]*for="${id}"[^>]*>Mountain name</label>`));
		expect(input).toContain('role="combobox"');
		expect(input).toContain('aria-autocomplete="list"');
		expect(input).toContain('aria-expanded="false"');
		expect(input).not.toContain('aria-controls');
		expect(input).toContain('autoComplete="off"');
		expect(html).not.toContain('role="listbox"');
		expect(statusOf(html)).toBe('Type to search 3 mountains.');
	});

	it('lists matching mountains as options with place and elevation', () => {
		const html = render(READY, 'mon');
		const input = inputOf(html);
		const listId = html.match(/<ul id="([^"]+)"[^>]*role="listbox"/)?.[1];

		expect(input).toContain('aria-expanded="true"');
		expect(input).toContain(`aria-controls="${listId}"`);
		expect(input).not.toContain('aria-activedescendant');
		expect(html).toContain('aria-label="Matching mountains"');
		expect(html.match(/role="option"/g)).toHaveLength(2);
		expect(html.match(/aria-selected="false"/g)).toHaveLength(2);
		expect(html).toContain('Mönch');
		expect(html).toContain('Switzerland · 4,110 m');
		expect(html.indexOf('Mönch')).toBeLessThan(html.indexOf('Mont Blanc'));
		expect(statusOf(html)).toBe('2 mountains found.');
	});

	it('names every country of a result', () => {
		expect(render(READY, 'aconc')).toContain('Argentina and Chile · 6,961 m');
		expect(statusOf(render(READY, 'aconc'))).toBe('1 mountain found.');
	});

	it('says plainly when nothing matches', () => {
		const html = render(READY, 'kilimanjaro ');

		expect(html).not.toContain('role="listbox"');
		expect(inputOf(html)).toContain('aria-expanded="false"');
		expect(statusOf(html)).toBe('No mountain matches “kilimanjaro”.');
	});

	it.each([
		[{ status: 'idle' } as const, 'Loading mountains…'],
		[{ status: 'loading' } as const, 'Loading mountains…']
	])('announces loading while the index is %j', (state, message) => {
		const html = render(state, 'mon');

		expect(statusOf(html)).toBe(message);
		expect(html).not.toContain('role="listbox"');
		expect(html).not.toContain('Try again');
	});

	it.each([
		['unreachable', 'Mountain data is unavailable right now.'],
		['api-error', 'The mountains could not be loaded.']
	] as const)('announces a %s failure and offers to try again', (reason, message) => {
		const html = render({ status: 'failed', reason }, 'mon');

		expect(statusOf(html)).toBe(message);
		expect(html).toMatch(/<button type="button"[^>]*>Try again<\/button>/);
		expect(html).not.toMatch(/50\d|error|stack/i);
	});

	it('explains an empty catalog', () => {
		expect(statusOf(render({ status: 'ready', index: [] }))).toBe(
			'No mountains are available to search yet.'
		);
	});
});
