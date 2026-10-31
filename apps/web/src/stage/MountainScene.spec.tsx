import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SceneState } from './sceneState';
import { SceneStore } from './SceneStore';
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

	return renderToStaticMarkup(<MountainScene store={store} target={TARGET} />);
}

describe('MountainScene markup', () => {
	it('renders one empty viewport for the engine to own', () => {
		const html = render();

		expect(html.match(/<div/g)).toHaveLength(2);
		expect(html).toMatch(/<div[^>]*><div[^>]*><\/div><\/div>/);
	});

	it.each([
		['loading', undefined],
		['ready', { status: 'ready' } as const],
		['degraded', { status: 'ready', imageryDegraded: true } as const]
	])('renders no notice while %s', (_name, state) => {
		expect(render(state)).not.toMatch(/role="alert"|globe/);
	});

	it('announces the missing token with the contractual message and no retry', () => {
		const html = render({ status: 'failed', failure: 'missing-token', message: 'no token' });

		expect(html).toContain('role="alert"');
		expect(html).toContain('The 3D globe isn&#x27;t available on this site.');
		expect(html).toContain('The mountain details are still available.');
		expect(html).not.toContain('<button');
		expect(html).not.toContain('no token');
	});

	it('announces an initialization failure without leaking the cause', () => {
		const html = render({
			status: 'failed',
			failure: 'initialization-failed',
			message: 'The 3D globe could not be loaded.'
		});

		expect(html).toContain('The 3D globe could not be loaded.');
		expect(html).not.toContain('<button');
	});
});
