import { isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ExploreButton } from './ExploreControl';

const noop = () => {};

describe('ExploreButton', () => {
	it('is a native button that submits nothing and names the action', () => {
		const html = renderToStaticMarkup(
			<ExploreButton slug="aconcagua" state={{ status: 'idle' }} onExplore={noop} />
		);

		expect(html).toMatch(/^<button type="button"/);
		expect(html).toContain('Explore another');
		expect(html).not.toContain('role=');
		expect(html).not.toContain('tabindex');
		expect(html).not.toMatch(/\sdisabled(=""|\s|>)/);
	});

	it('hides the decorative arrow from assistive technology', () => {
		const html = renderToStaticMarkup(
			<ExploreButton slug="aconcagua" state={{ status: 'idle' }} onExplore={noop} />
		);

		expect(html).toMatch(/<span[^>]*aria-hidden="true"[^>]*>→<\/span>/);
	});

	it('exposes the busy state while exploring and stays focusable', () => {
		const html = renderToStaticMarkup(
			<ExploreButton slug="aconcagua" state={{ status: 'loading' }} onExplore={noop} />
		);

		expect(html).toContain('aria-busy="true"');
		expect(html).toContain('aria-disabled="true"');
		expect(html).toContain('Exploring…');
		expect(html).not.toContain('Explore another');
		expect(html).not.toContain('→');
		expect(html).not.toMatch(/\sdisabled(=""|\s|>)/);
	});

	it('is not busy when idle or failed', () => {
		for (const state of [
			{ status: 'idle' },
			{ status: 'failed', message: 'x', from: 'aconcagua' }
		] as const) {
			const html = renderToStaticMarkup(
				<ExploreButton slug="aconcagua" state={state} onExplore={noop} />
			);

			expect(html).toContain('aria-busy="false"');
			expect(html).toContain('aria-disabled="false"');
		}
	});

	it('announces the failure of an exploration started from this mountain', () => {
		const html = renderToStaticMarkup(
			<ExploreButton
				slug="aconcagua"
				state={{
					status: 'failed',
					message: 'No mountain is available right now.',
					from: 'aconcagua'
				}}
				onExplore={noop}
			/>
		);

		expect(html).toMatch(/<p[^>]*role="alert"[^>]*>No mountain is available right now\.<\/p>/);
	});

	it('does not show the failure of another mountain page', () => {
		const html = renderToStaticMarkup(
			<ExploreButton
				slug="mount-olympus"
				state={{
					status: 'failed',
					message: 'No mountain is available right now.',
					from: 'aconcagua'
				}}
				onExplore={noop}
			/>
		);

		expect(html).not.toContain('role="alert"');
		expect(html).not.toContain('No mountain');
	});

	it('shows no alert while idle or busy', () => {
		for (const status of ['idle', 'loading'] as const) {
			const html = renderToStaticMarkup(
				<ExploreButton slug="aconcagua" state={{ status }} onExplore={noop} />
			);

			expect(html).not.toContain('role="alert"');
		}
	});

	it('runs the exploration once per activation', () => {
		const onExplore = vi.fn();
		const element = ExploreButton({ slug: 'aconcagua', state: { status: 'idle' }, onExplore });

		expect(isValidElement(element)).toBe(true);
		const button = (element as { props: { children: unknown[] } }).props.children[0] as {
			props: { onClick: () => void };
		};
		button.props.onClick();

		expect(onExplore).toHaveBeenCalledTimes(1);
	});
});
