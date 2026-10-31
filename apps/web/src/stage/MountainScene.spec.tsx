import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SceneState } from './sceneState';
import { SceneStore } from './SceneStore';
import { TransitionCoordinator } from './TransitionCoordinator';
import MountainScene from './MountainScene';
import type { SceneTarget } from './globe/camera';

const TARGET: SceneTarget = {
	slug: 'aconcagua',
	name: 'Aconcagua',
	latitude: -32.65,
	longitude: -70.01,
	elevationMeters: 6961
};

function render(state?: SceneState): string {
	const store = new SceneStore();
	if (state) {
		store.setState(state);
	}

	return renderToStaticMarkup(
		<MountainScene store={store} target={TARGET} observer={new TransitionCoordinator()} />
	);
}

describe('MountainScene markup', () => {
	it('renders one empty viewport for the engine to own', () => {
		const html = render();

		expect(html.match(/<div/g)).toHaveLength(2);
		expect(html).toMatch(/<div[^>]*><div[^>]*><\/div><\/div>/);
	});

	it.each([
		['loading', undefined],
		['ready', { status: 'ready' } as const]
	])('renders no notice while %s', (_name, state) => {
		expect(render(state)).not.toMatch(/role="alert"|globe/);
	});

	it('keeps the stage controls and adds the polite imagery notice while degraded', () => {
		const html = render({ status: 'ready', imageryDegraded: true });

		expect(html).toContain('Reset view');
		expect(html).toContain('role="status"');
		expect(html).toContain('Map imagery is temporarily unavailable.');
		expect(html).not.toContain('role="alert"');
	});

	it('renders no stage controls before the globe is ready', () => {
		for (const state of [
			undefined,
			{ status: 'failed', failure: 'missing-token', message: 'x' } as const
		]) {
			expect(render(state)).not.toMatch(/<button|Compass|Scale:/);
		}
	});

	it('renders the stage controls beside the viewport, never inside it', () => {
		const store = new SceneStore();
		store.setState({ status: 'ready' });
		store.setOrientation({ viewHeadingDegrees: 10 });
		const html = renderToStaticMarkup(
			<MountainScene store={store} target={TARGET} observer={new TransitionCoordinator()} />
		);

		expect(html).toMatch(/<div[^>]*><div[^>]*><\/div>.*Reset view/s);
		expect(html).toContain('Compass. Looking 10 degrees north.');
	});

	it('announces the missing token with the contractual message and no retry', () => {
		const html = render({ status: 'failed', failure: 'missing-token', message: 'no token' });

		expect(html).toContain('role="alert"');
		expect(html).toContain('The 3D globe isn&#x27;t available on this site.');
		expect(html).toContain('The mountain details are still available.');
		expect(html).not.toContain('<button');
		expect(html).not.toContain('no token');
	});

	it('offers a retry for an initialization failure and hides the stage controls', () => {
		const html = render({
			status: 'failed',
			failure: 'initialization-failed',
			message: 'The 3D globe could not be loaded.'
		});

		expect(html).toContain('The 3D globe could not be loaded.');
		expect(html.match(/<button/g)).toHaveLength(1);
		expect(html).toContain('>Try again</button>');
		expect(html).not.toContain('Reset view');
	});
});
