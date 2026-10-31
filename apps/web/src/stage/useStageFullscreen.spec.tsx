import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { useStageFullscreen } from './useStageFullscreen';

function Probe() {
	const { supported, active } = useStageFullscreen({ current: null });

	return <p>{`${supported}/${active}`}</p>;
}

describe('useStageFullscreen', () => {
	it('reports no fullscreen on the server, where there is no document to ask', () => {
		expect(renderToStaticMarkup(<Probe />)).toBe('<p>false/false</p>');
	});
});
