import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
	TransitionCoordinatorProvider,
	useTransitionCoordinator
} from './TransitionCoordinatorContext';
import { TransitionCoordinator } from './TransitionCoordinator';

function Probe() {
	return (
		<p>{useTransitionCoordinator() instanceof TransitionCoordinator ? 'provided' : 'other'}</p>
	);
}

describe('TransitionCoordinatorContext', () => {
	it('hands the one coordinator to the components below it', () => {
		const html = renderToStaticMarkup(
			<TransitionCoordinatorProvider value={new TransitionCoordinator()}>
				<Probe />
			</TransitionCoordinatorProvider>
		);

		expect(html).toBe('<p>provided</p>');
	});

	it('refuses to create a coordinator of its own when none was provided', () => {
		expect(() => renderToStaticMarkup(<Probe />)).toThrow('TransitionCoordinatorProvider');
	});
});
