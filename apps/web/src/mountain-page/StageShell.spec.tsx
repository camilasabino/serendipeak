import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SceneStore } from '../stage/SceneStore';
import { StageShell } from './StageShell';

function render(store: SceneStore, daily = false): string {
	return renderToStaticMarkup(
		<StageShell store={store} daily={daily}>
			<p>scene</p>
		</StageShell>
	);
}

describe('StageShell', () => {
	it('shows the loader over the scene while the scene is loading', () => {
		const html = render(new SceneStore());

		expect(html).toContain('role="status"');
		expect(html.indexOf('scene')).toBeLessThan(html.indexOf('role="status"'));
	});

	it.each([
		['ready', { status: 'ready' } as const],
		['failed', { status: 'failed', failure: 'missing-token', message: 'No token.' } as const]
	])('removes the loader once the scene is %s', (_name, state) => {
		const store = new SceneStore();
		store.setState(state);

		const html = render(store);

		expect(html).not.toContain('role="status"');
		expect(html).toContain('scene');
	});

	it('is a programmatic focus anchor that is never a tab stop', () => {
		const html = render(new SceneStore());

		expect(html).toMatch(/<div[^>]*tabindex="-1"[^>]*data-stage=""/);
	});
});
