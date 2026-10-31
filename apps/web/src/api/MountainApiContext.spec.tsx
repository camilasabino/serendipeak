import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FakeMountainApi } from './test-support/FakeMountainApi';
import { MountainApiProvider, useMountainApi } from './MountainApiContext';

function Probe() {
	return <p>{useMountainApi() instanceof FakeMountainApi ? 'provided' : 'other'}</p>;
}

describe('MountainApiContext', () => {
	it('hands the provided API to the components below it', () => {
		const html = renderToStaticMarkup(
			<MountainApiProvider value={new FakeMountainApi()}>
				<Probe />
			</MountainApiProvider>
		);

		expect(html).toBe('<p>provided</p>');
	});

	it('refuses to guess an API when none was provided', () => {
		expect(() => renderToStaticMarkup(<Probe />)).toThrow('MountainApiProvider');
	});
});
