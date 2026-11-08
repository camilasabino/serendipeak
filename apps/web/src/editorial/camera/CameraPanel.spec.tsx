import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { assessCamera } from './canonicalCamera';
import { CameraPanel, type PanelState } from './CameraPanel';
import type { CameraOrigin } from './editorQuery';

const VALID = assessCamera({
	headingDegrees: 123.456,
	pitchDegrees: -12.5,
	rangeMeters: 4321,
	framing: { x: 0.125, y: -0.25 }
});

function render(
	state: PanelState,
	overrides: { origin?: CameraOrigin; canRestore?: boolean } = {}
) {
	return renderToStaticMarkup(
		<CameraPanel
			name="Aconcagua"
			cameraOrigin={overrides.origin ?? 'saved'}
			state={state}
			canRestore={overrides.canRestore ?? true}
			backHref="http://localhost:8000/studio/mountains/aconcagua/"
			onSave={() => {}}
			onRestore={() => {}}
		/>
	);
}

function button(html: string, label: string): string {
	const match = new RegExp(`<button[^>]*>${label}</button>`).exec(html);
	if (!match) {
		throw new Error(`no ${label} button in ${html}`);
	}
	return match[0];
}

describe('CameraPanel', () => {
	it('names the mountain and links back to its Studio page', () => {
		const html = render({ kind: 'ready', assessment: VALID });

		expect(html).toContain('>Aconcagua</h1>');
		expect(html).toMatch(
			/<a[^>]*href="http:\/\/localhost:8000\/studio\/mountains\/aconcagua\/"[^>]*>Back to the mountain<\/a>/
		);
	});

	it('shows the live pose as it would be saved and enables saving when valid', () => {
		const html = render({ kind: 'ready', assessment: VALID });

		expect(html).toContain('<dd>123.46°</dd>');
		expect(html).toContain('<dd>-12.5°</dd>');
		expect(html).toContain('<dd>4321 m</dd>');
		expect(html).toContain('<dd>0.125, -0.25</dd>');
		expect(html).toContain('Ready to save.');
		expect(button(html, 'Save camera…')).not.toContain('disabled');
	});

	it.each([
		['loading', { kind: 'loading' } as const, 'Loading the globe…'],
		['flying', { kind: 'flying' } as const, 'Moving the view…'],
		['unavailable', { kind: 'unavailable' } as const, 'cannot be edited']
	])('disables saving and shows no pose while %s', (_name, state, copy) => {
		const html = render(state);

		expect(html).toContain(copy);
		expect(html).toContain('<dd>—</dd>');
		expect(button(html, 'Save camera…')).toContain('disabled');
	});

	it('disables saving and explains a summit that is off screen', () => {
		const html = render({
			kind: 'ready',
			assessment: assessCamera({ headingDegrees: 10, pitchDegrees: -10, rangeMeters: 5000 })
		});

		expect(html).toContain('The summit is outside the view.');
		expect(html).toContain('<dd>none</dd>');
		expect(button(html, 'Save camera…')).toContain('disabled');
	});

	it('explains an out-of-bounds pose with the catalog limits and says it once', () => {
		const html = render({
			kind: 'ready',
			assessment: assessCamera({
				headingDegrees: 10,
				pitchDegrees: 30,
				rangeMeters: 1000,
				framing: { x: 5, y: 5 }
			})
		});

		expect(html).toContain('pitch from -60 to 15 degrees, range from 2000 to 80000 meters');
		expect(html.match(/The summit is outside the view\./g)).toHaveLength(1);
		expect(button(html, 'Save camera…')).toContain('disabled');
	});

	it('names what it opened on and what restoring returns to', () => {
		const ready = { kind: 'ready', assessment: VALID } as const;
		const saved = render(ready, { origin: 'saved' });
		const proposed = render(ready, { origin: 'proposed' });
		const automatic = render(ready, { origin: 'none' });

		expect(saved).toContain('Restore saved camera');
		expect(saved).toContain('Opened on the saved camera.');
		expect(proposed).toContain('Restore proposed camera');
		expect(proposed).toContain('It is not saved yet.');
		expect(proposed).not.toContain('saved camera');
		expect(automatic).toContain('Restore automatic view');
		expect(automatic).toContain('opened on the automatic view');
	});

	it('disables restoring while the view cannot be reset', () => {
		const html = render({ kind: 'flying' }, { canRestore: false });

		expect(button(html, 'Restore saved camera')).toContain('disabled');
	});

	it('announces validity politely', () => {
		expect(render({ kind: 'flying' })).toContain('role="status"');
	});
});
