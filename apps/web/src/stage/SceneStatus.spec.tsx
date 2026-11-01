import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { INITIALIZATION_FAILED_STATE, type SceneState } from './sceneState';
import { SceneStatus } from './SceneStatus';

const MISSING_TOKEN: SceneState = {
	status: 'failed',
	failure: 'missing-token',
	message: 'NEXT_PUBLIC_CESIUM_ION_TOKEN is not set.'
};

function render(state: SceneState, onRetry?: () => void): string {
	return renderToStaticMarkup(<SceneStatus state={state} onRetry={onRetry} />);
}

describe('SceneStatus failure', () => {
	it('announces an initialization failure with the contract copy and a native retry button', () => {
		const html = render(INITIALIZATION_FAILED_STATE, () => {});

		expect(html).toContain('role="alert"');
		expect(html).toContain('The 3D globe could not be loaded.');
		expect(html).toContain('The mountain details are still available.');
		expect(html).toMatch(/<button[^>]*type="button"[^>]*>Try again<\/button>/);
		expect(html.match(/<button/g)).toHaveLength(1);
	});

	it('announces a missing token without retry or configuration details', () => {
		const html = render(MISSING_TOKEN);

		expect(html).toContain('role="alert"');
		expect(html).toContain('The 3D globe isn&#x27;t available on this site.');
		expect(html).toContain('The mountain details are still available.');
		expect(html).not.toContain('<button');
		expect(html).not.toMatch(/NEXT_PUBLIC|token is not set/);
	});

	it('offers no retry when the caller supplies none', () => {
		expect(render(INITIALIZATION_FAILED_STATE)).not.toContain('<button');
	});

	it('never leaks the cause carried by the state', () => {
		const html = render(
			{
				status: 'failed',
				failure: 'initialization-failed',
				message: 'Error: ion 401 at https://x'
			},
			() => {}
		);

		expect(html).not.toMatch(/ion 401|https:/);
	});
});

describe('SceneStatus degraded imagery', () => {
	it('announces the generic notice politely, never as an alert', () => {
		const html = render({ status: 'ready', imageryDegraded: true });

		expect(html).toContain('role="status"');
		expect(html).toContain('Map imagery is temporarily unavailable.');
		expect(html).toContain('The mountain details are still available.');
		expect(html).not.toContain('role="alert"');
		expect(html).not.toContain('<button');
	});

	it.each([
		['loading', { status: 'loading' } as const],
		['ready', { status: 'ready' } as const]
	])('keeps only an empty status region mounted while %s', (_name, state) => {
		expect(render(state)).toBe('<div role="status"></div>');
	});

	it('fills the same status region that is empty otherwise, so the notice is announced when it appears', () => {
		const html = render({ status: 'ready', imageryDegraded: true });

		expect(html).toMatch(/^<div role="status" class="[^"]*notice[^"]*"><p>/);
		expect(html.match(/role="status"/g)).toHaveLength(1);
	});
});
