import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SceneSnapshot } from '../SceneStore';
import { SceneStore } from '../SceneStore';
import type { StageFullscreen } from '../useStageFullscreen';
import { StageControls } from './StageControls';

const READING = { label: '2 km', meters: 2000, widthPx: 96 };

const UNSUPPORTED: StageFullscreen = { supported: false, active: false, toggle: () => {} };

function render(snapshot: SceneSnapshot, fullscreen: StageFullscreen = UNSUPPORTED): string {
	return renderToStaticMarkup(
		<StageControls snapshot={snapshot} onReset={() => {}} fullscreen={fullscreen} />
	);
}

function readyStore(): SceneStore {
	const store = new SceneStore();
	store.setState({ status: 'ready' });
	store.setOrientation({ viewHeadingDegrees: 30 });
	store.setScale(READING);
	store.setSettled(true);
	return store;
}

describe('StageControls visibility', () => {
	it('renders no control while the globe is loading, even with scene readings', () => {
		const store = readyStore();
		store.setState({ status: 'loading' });

		expect(render(store.getSnapshot())).toBe('');
	});

	it.each(['missing-token', 'initialization-failed'] as const)(
		'renders no control when the globe failed (%s)',
		(failure) => {
			const store = readyStore();
			store.setState({ status: 'failed', failure, message: 'x' });

			expect(render(store.getSnapshot())).toBe('');
		}
	);

	it('renders compass, scale and Reset over a ready scene', () => {
		const html = render(readyStore().getSnapshot());

		expect(html).toContain('Compass. Looking 30 degrees northeast.');
		expect(html).toContain('2 km');
		expect(html).toContain('Reset view');
	});

	it('keeps all controls over degraded imagery', () => {
		const store = readyStore();
		store.setState({ status: 'ready', imageryDegraded: true });
		const html = render(store.getSnapshot());

		expect(html).toContain('Compass.');
		expect(html).toContain('Reset view');
		expect(html).not.toMatch(/<button[^>]*\sdisabled/);
	});
});

describe('StageControls follow the store', () => {
	it('gates Reset on the settled state published by the scene', () => {
		const store = readyStore();
		store.setSettled(false);
		expect(render(store.getSnapshot())).toMatch(/<button[^>]*\sdisabled/);

		store.setSettled(true);
		expect(render(store.getSnapshot())).not.toMatch(/<button[^>]*\sdisabled/);
	});

	it('shows the latest heading and drops the compass when the heading is lost', () => {
		const store = readyStore();
		store.setOrientation({ viewHeadingDegrees: 200 });
		expect(render(store.getSnapshot())).toContain('Looking 200 degrees south.');

		store.setOrientation(undefined);
		expect(render(store.getSnapshot())).not.toContain('Compass.');
	});

	it('shows the latest scale and drops the bar when the scale is unavailable', () => {
		const store = readyStore();
		store.setScale({ label: '500 m', meters: 500, widthPx: 70 });
		expect(render(store.getSnapshot())).toContain('500 m');
		expect(render(store.getSnapshot())).not.toContain('2 km');

		store.setScale(undefined);
		const html = render(store.getSnapshot());
		expect(html).not.toContain('Scale:');
		expect(html).toContain('Compass.');
		expect(html).toContain('Reset view');
	});

	it('renders only Reset while neither heading nor scale is available', () => {
		const store = new SceneStore();
		store.setState({ status: 'ready' });
		const html = render(store.getSnapshot());

		expect(html.match(/<button/g)).toHaveLength(1);
		expect(html).not.toMatch(/Compass|Scale:/);
		expect(html).toMatch(/<button[^>]*\sdisabled/);
	});
});

describe('StageControls fullscreen', () => {
	const SUPPORTED: StageFullscreen = { supported: true, active: false, toggle: () => {} };

	it('offers no fullscreen control when the browser cannot provide it', () => {
		expect(render(readyStore().getSnapshot())).not.toMatch(/fullscreen/i);
	});

	it('offers entering fullscreen beside Reset when supported', () => {
		const html = render(readyStore().getSnapshot(), SUPPORTED);

		expect(html).toContain('Enter fullscreen');
		expect(html.indexOf('Reset view')).toBeLessThan(html.indexOf('Enter fullscreen'));
	});

	it('offers leaving fullscreen while the stage is fullscreen', () => {
		const html = render(readyStore().getSnapshot(), { ...SUPPORTED, active: true });

		expect(html).toContain('Exit fullscreen');
		expect(html).not.toContain('Enter fullscreen');
	});

	it('renders no fullscreen control over a stage without a ready globe', () => {
		const store = readyStore();
		store.setState({ status: 'loading' });

		expect(render(store.getSnapshot(), SUPPORTED)).toBe('');
	});
});
