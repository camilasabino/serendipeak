import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { INITIALIZATION_FAILED_STATE } from './sceneState';
import { SceneStore } from './SceneStore';
import { StageBoundary, StageChunkLoadError } from './StageBoundary';

afterEach(() => {
	vi.restoreAllMocks();
});

function mount(store = new SceneStore()) {
	const boundary = new StageBoundary({ store, children: <p>scene</p> });
	const setState = vi.spyOn(boundary, 'setState').mockImplementation((update) => {
		boundary.state = { ...boundary.state, ...(update as object) };
	});

	return { boundary, store, setState };
}

describe('StageBoundary', () => {
	it('renders its children until something fails', () => {
		const { boundary } = mount();

		expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe('<p>scene</p>');
	});

	it('turns a failed chunk into a state the stage can retry', () => {
		const retry = vi.fn();

		const state = StageBoundary.getDerivedStateFromError(
			new StageChunkLoadError(new Error('x'), retry)
		);

		expect(state.failed?.reload).toBe(retry);
	});

	it('leaves a render failure without a chunk reload', () => {
		const state = StageBoundary.getDerivedStateFromError(new Error('render crash'));

		expect(state.failed).toEqual({ reload: undefined });
	});

	it('leaves the loader and publishes the controlled failure through the scene store', () => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
		const { boundary, store } = mount();
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });

		boundary.componentDidCatch(new StageChunkLoadError(new Error('chunk 404'), vi.fn()));

		expect(store.getSnapshot().state).toEqual(INITIALIZATION_FAILED_STATE);
	});

	it('logs the cause for developers and keeps it out of the markup', () => {
		const log = vi.spyOn(console, 'error').mockImplementation(() => {});
		const { boundary } = mount();
		const cause = new Error('Loading chunk 42 failed (https://cdn.example/42.js)');
		boundary.state = StageBoundary.getDerivedStateFromError(
			new StageChunkLoadError(cause, vi.fn())
		);

		boundary.componentDidCatch(new StageChunkLoadError(cause, vi.fn()));
		const html = renderToStaticMarkup(<>{boundary.render()}</>);

		expect(log).toHaveBeenCalledOnce();
		expect(html).toContain('role="alert"');
		expect(html).toContain('The 3D globe could not be loaded.');
		expect(html).toContain('>Try again</button>');
		expect(html).not.toMatch(/chunk 42|cdn\.example/);
	});

	it('retries by reloading the chunk, showing the loader and rendering the children again', () => {
		const reload = vi.fn();
		const { boundary, store, setState } = mount();
		store.setState(INITIALIZATION_FAILED_STATE);
		boundary.state = StageBoundary.getDerivedStateFromError(
			new StageChunkLoadError(new Error('x'), reload)
		);

		boundary.retry();

		expect(reload).toHaveBeenCalledOnce();
		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
		expect(setState).toHaveBeenCalledWith({ failed: undefined });
		expect(renderToStaticMarkup(<>{boundary.render()}</>)).toBe('<p>scene</p>');
	});

	it('retries a render failure by remounting the children without a chunk reload', () => {
		const { boundary, store } = mount();
		boundary.state = StageBoundary.getDerivedStateFromError(new Error('render crash'));

		expect(() => boundary.retry()).not.toThrow();

		expect(store.getSnapshot().state).toEqual({ status: 'loading' });
		expect(boundary.state.failed).toBeUndefined();
	});
});
