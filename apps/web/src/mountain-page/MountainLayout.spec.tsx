import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DailyMountain, Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import { TestExperience } from '../test/TestExperience';
import { MountainLayout } from './MountainLayout';
import { MountainView } from './MountainView';
import { countOf } from './test-support/markup';
import type { MountainModel } from './pageModel';

const mountain = contractFixture('mountain-complete.json') as Mountain;
const daily = contractFixture('daily-mountain.json') as DailyMountain;

function render(model: MountainModel): string {
	const daily_ = model.kind === 'daily';
	const shown = model.kind === 'daily' ? model.daily.mountain : model.mountain;

	return renderToStaticMarkup(
		<TestExperience>
			<MountainLayout model={model}>
				<MountainView mountain={shown} daily={daily_} />
			</MountainLayout>
		</TestExperience>
	);
}

const STAGE_LOADER = 'role="status"';

describe.each([
	['a permalink', { kind: 'mountain', mountain } as const],
	['the daily page', { kind: 'daily', daily } as const]
])('MountainLayout on %s', (_name, model) => {
	const html = render(model);

	it('renders one main landmark that holds the sheet and the stage', () => {
		expect(countOf(html, 'main')).toBe(1);
		expect(html.indexOf('<main')).toBeLessThan(html.indexOf('<h1'));
		expect(html.indexOf(STAGE_LOADER)).toBeLessThan(html.indexOf('</main>'));
	});

	it('reads every editorial element before the stage', () => {
		const stage = html.indexOf(STAGE_LOADER);

		expect(stage).toBeGreaterThan(-1);
		expect(html.lastIndexOf('</section>')).toBeLessThan(stage);
		for (const label of ['Elevation', 'Coordinates', 'Data sources', 'About this photo']) {
			expect(html.indexOf(label)).toBeLessThan(stage);
		}
	});

	it('renders the loader as the only stage content before the globe mounts', () => {
		expect(countOf(html, 'canvas')).toBe(0);
		expect(countOf(html.replace(/<figure[\s\S]*?<\/figure>/, ''), 'button')).toBe(0);
		expect(html).not.toMatch(/role="alert"|cesium/i);
	});
});

describe('MountainLayout reveal announcement', () => {
	it('uses the permalink wording', () => {
		expect(render({ kind: 'mountain', mountain })).toContain('Revealing the mountain...');
	});

	it('uses the daily wording', () => {
		expect(render({ kind: 'daily', daily })).toContain('Revealing today&#x27;s mountain...');
	});
});

describe('daily cue placement', () => {
	it('keeps the cue before the stage', () => {
		const html = render({ kind: 'daily', daily });

		expect(html.indexOf('Tomorrow, another mountain.')).toBeLessThan(html.indexOf(STAGE_LOADER));
	});
});
