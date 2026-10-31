import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ImagePreloaderProvider, useImagePreloader } from './ImagePreloaderContext';
import { ImagePreloader } from './preload';

function Probe() {
	return <p>{useImagePreloader() instanceof ImagePreloader ? 'provided' : 'other'}</p>;
}

describe('ImagePreloaderContext', () => {
	it('hands the one shared preloader to the components below it', () => {
		const html = renderToStaticMarkup(
			<ImagePreloaderProvider value={new ImagePreloader()}>
				<Probe />
			</ImagePreloaderProvider>
		);

		expect(html).toBe('<p>provided</p>');
	});

	it('refuses to create a preloader of its own when none was provided', () => {
		expect(() => renderToStaticMarkup(<Probe />)).toThrow('ImagePreloaderProvider');
	});
});
