import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DailyMountain, Mountain } from '../api/contract';
import { contractFixture } from '../api/test-support/contractFixtures';
import type { NearbyMountain } from '../nearby/findNearbyMountains';
import { NEARBY_INDICATORS_LABEL } from '../nearby/NearbyIndicators';
import { TestExperience } from '../test/TestExperience';
import { StageLayout } from './StageLayout';
import { MountainView } from './MountainView';
import { countOf, textsOf } from './test-support/markup';
import type { MountainModel } from './pageModel';

const mountain = contractFixture('mountain-complete.json') as Mountain;
const daily = contractFixture('daily-mountain.json') as DailyMountain;

function render(model: MountainModel): string {
	const daily_ = model.kind === 'daily';
	const shown = model.kind === 'daily' ? model.daily.mountain : model.mountain;

	return renderToStaticMarkup(
		<TestExperience>
			<StageLayout model={model}>
				<MountainView mountain={shown} daily={daily_} />
			</StageLayout>
		</TestExperience>
	);
}

const STAGE_LOADER = 'role="status"';

describe.each([
	['a permalink', { kind: 'mountain', mountain } as const],
	['the daily page', { kind: 'daily', daily } as const]
])('StageLayout on %s', (_name, model) => {
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
		for (const label of ['Elevation', 'Coordinates', 'About this photo']) {
			expect(html.indexOf(label)).toBeLessThan(stage);
		}
	});

	it('renders the loader as the only stage content before the globe mounts', () => {
		expect(countOf(html, 'canvas')).toBe(0);
		expect(textsOf(html, 'button')).toEqual([
			'Copy link',
			'View photo fullscreen',
			'Explore another'
		]);
		expect(html).not.toMatch(/role="alert"|cesium/i);
	});
});

describe('StageLayout reveal announcement', () => {
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

describe('StageLayout with nearby mountains', () => {
	const EL_PLATA: NearbyMountain = {
		slug: 'cerro-el-plata',
		name: 'Cerro El Plata',
		place: 'Argentina',
		elevationMeters: 5968,
		coordinates: { latitude: -33.015925, longitude: -69.454922 },
		distanceKm: 66
	};

	it('links each neighbour once, from the sheet: the stage points to them only once the globe is up', () => {
		const html = renderToStaticMarkup(
			<TestExperience>
				<StageLayout model={{ kind: 'mountain', mountain }} nearby={[EL_PLATA]}>
					<MountainView mountain={mountain} daily={false} nearby={[EL_PLATA]} />
				</StageLayout>
			</TestExperience>
		);

		expect(html.match(/href="\/mountains\/cerro-el-plata"/g)).toHaveLength(1);
		expect(html).not.toContain(NEARBY_INDICATORS_LABEL);
	});
});
