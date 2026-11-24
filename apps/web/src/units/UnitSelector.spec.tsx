import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { indexEntry } from '../api/test-support/indexEntries';
import { describeEntry } from '../mountain-index/describeEntry';
import { UnitPreferenceProvider } from './UnitPreferenceContext';
import { UnitPreferenceStore } from './UnitPreferenceStore';
import { UnitSelector } from './UnitSelector';

function render(store?: UnitPreferenceStore): string {
	return renderToStaticMarkup(
		<UnitPreferenceProvider value={store}>
			<UnitSelector />
		</UnitPreferenceProvider>
	);
}

describe('UnitSelector', () => {
	it('is a labelled group of two native buttons with metric pressed by default', () => {
		const html = render();

		expect(html).toContain('role="group" aria-label="Units"');
		expect(html.match(/<button type="button"/g)).toHaveLength(2);
		expect(html).toMatch(/aria-pressed="true"[^>]*aria-label="Metric, meters"/);
		expect(html).toMatch(/aria-pressed="false"[^>]*aria-label="Imperial, feet"/);
	});

	it('renders the server markup as metric even when the stored choice is imperial', () => {
		const store = new UnitPreferenceStore({ getItem: () => 'imperial', setItem: () => {} });

		expect(render(store)).toMatch(/aria-pressed="true"[^>]*aria-label="Metric, meters"/);
	});
});

describe('describeEntry with units', () => {
	const entry = indexEntry('mont-blanc', 'Mont Blanc', { elevationMeters: 4806 });

	it('shows feet for imperial and leaves the entry untouched', () => {
		expect(describeEntry(entry, 'imperial')).toContain('15,768 ft');
		expect(describeEntry(entry)).toContain('4,806 m');
		expect(entry.elevationMeters).toBe(4806);
	});
});
