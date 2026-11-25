import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SceneSnapshot } from '../SceneStore';
import { SceneStore } from '../SceneStore';
import type { StageFullscreen } from '../useStageFullscreen';
import { navigationGuide, type NavigationHelpContext } from '../stageCopy';
import { StageControls, type MarkerToggle } from './StageControls';

const READING = { label: '2 km', meters: 2000, widthPx: 96 };

const UNSUPPORTED: StageFullscreen = { supported: false, active: false, toggle: () => {} };
const SUPPORTED: StageFullscreen = { supported: true, active: false, toggle: () => {} };

const SHOWN: MarkerToggle = { shown: true, onToggle: () => {} };
const HIDDEN: MarkerToggle = { shown: false, onToggle: () => {} };

const ATLAS: NavigationHelpContext = {
	kind: 'atlas',
	markersHidden: false,
	rotation: true,
	fullscreen: true
};
const MOUNTAIN: NavigationHelpContext = { kind: 'mountain', orbit: true, fullscreen: true };

function render(
	snapshot: SceneSnapshot,
	fullscreen: StageFullscreen = UNSUPPORTED,
	markerToggle?: MarkerToggle,
	onToggleMountainOrbit?: () => void
): string {
	return renderToStaticMarkup(
		<StageControls
			snapshot={snapshot}
			onReset={() => {}}
			onZoom={() => {}}
			onToggleRotation={() => {}}
			onToggleMountainOrbit={onToggleMountainOrbit}
			fullscreen={fullscreen}
			markerToggle={markerToggle}
		/>
	);
}

function readyStore(): SceneStore {
	const store = new SceneStore();
	store.setState({ status: 'ready' });
	store.setOrientation({ viewHeadingDegrees: 30 });
	store.setScale(READING);
	store.setSettled(true);
	return store;
}

describe('StageControls visibility', () => {
	it('renders no control while the globe is loading, even with scene readings', () => {
		const store = readyStore();
		store.setState({ status: 'loading' });

		expect(render(store.getSnapshot())).toBe('');
	});

	it.each(['missing-token', 'initialization-failed'] as const)(
		'renders no control when the globe failed (%s)',
		(failure) => {
			const store = readyStore();
			store.setState({ status: 'failed', failure, message: 'x' });

			expect(render(store.getSnapshot())).toBe('');
		}
	);

	it('renders compass, scale and Reset over a ready scene', () => {
		const html = render(readyStore().getSnapshot());

		expect(html).toContain('Compass. Looking 30 degrees northeast.');
		expect(html).toContain('2 km');
		expect(html).toContain('Reset view');
	});

	it('keeps all controls over degraded imagery', () => {
		const store = readyStore();
		store.setState({ status: 'ready', imageryDegraded: true });
		const html = render(store.getSnapshot());

		expect(html).toContain('Compass.');
		expect(html).toContain('Reset view');
		expect(html).not.toMatch(/<button[^>]*\sdisabled/);
	});
});

describe('StageControls follow the store', () => {
	it('gates Reset on the settled state published by the scene', () => {
		const store = readyStore();
		store.setSettled(false);
		expect(render(store.getSnapshot())).toMatch(/<button[^>]*\sdisabled/);

		store.setSettled(true);
		expect(render(store.getSnapshot())).not.toMatch(/<button[^>]*\sdisabled/);
	});

	it('shows the latest heading and drops the compass when the heading is lost', () => {
		const store = readyStore();
		store.setOrientation({ viewHeadingDegrees: 200 });
		expect(render(store.getSnapshot())).toContain('Looking 200 degrees south.');

		store.setOrientation(undefined);
		expect(render(store.getSnapshot())).not.toContain('Compass.');
	});

	it('shows the latest scale and drops the bar when the scale is unavailable', () => {
		const store = readyStore();
		store.setScale({ label: '500 m', meters: 500, widthPx: 70 });
		expect(render(store.getSnapshot())).toContain('500 m');
		expect(render(store.getSnapshot())).not.toContain('2 km');

		store.setScale(undefined);
		const html = render(store.getSnapshot());
		expect(html).not.toContain('Scale:');
		expect(html).toContain('Compass.');
		expect(html).toContain('Reset view');
	});

	it('renders only the buttons while neither heading nor scale is available', () => {
		const store = new SceneStore();
		store.setState({ status: 'ready' });
		const html = render(store.getSnapshot());

		expect(html.match(/<button/g)).toHaveLength(8);
		expect(html).not.toMatch(/Compass|Scale:/);
		expect(html.match(/<button[^>]*\sdisabled/g)).toHaveLength(3);
	});
});

function button(html: string, label: string): string {
	const match = new RegExp(
		`<button[^>]*>(?:(?!</button>).)*${label}(?:(?!</button>).)*</button>`
	).exec(html);
	expect(match, label).not.toBeNull();
	return match![0];
}

describe('StageControls zoom', () => {
	it('offers labelled Zoom in and Zoom out buttons in a Zoom group', () => {
		const html = render(readyStore().getSnapshot());

		expect(html).toMatch(/<div role="group" aria-label="Zoom"[^>]*>.*Zoom in.*Zoom out.*<\/div>/);
		expect(button(html, 'Zoom in')).toMatch(/^<button type="button"/);
		expect(button(html, 'Zoom out')).not.toContain('disabled');
	});

	it('disables zoom with Reset until the mountain settles, and keeps help available', () => {
		const store = readyStore();
		store.setSettled(false);
		const html = render(store.getSnapshot());

		expect(button(html, 'Zoom in')).toContain('disabled');
		expect(button(html, 'Zoom out')).toContain('disabled');
		expect(button(html, 'Reset view')).toContain('disabled');
		expect(button(html, 'How to navigate')).not.toContain('disabled');
	});

	it('places zoom and help apart from Reset and fullscreen', () => {
		const html = render(readyStore().getSnapshot(), {
			supported: true,
			active: false,
			toggle: () => {}
		});

		expect(html.indexOf('Zoom in')).toBeLessThan(html.indexOf('Zoom out'));
		expect(html.indexOf('Zoom out')).toBeLessThan(html.indexOf('How to navigate'));
		expect(html.indexOf('How to navigate')).toBeLessThan(html.indexOf('Reset view'));
	});
});

describe('StageControls navigation help', () => {
	it('starts closed, with the trigger pointing at a hidden, labelled dialog', () => {
		const html = render(readyStore().getSnapshot());
		const trigger = button(html, 'How to navigate');
		const controls = /aria-controls="([^"]+)"/.exec(trigger)![1];

		expect(trigger).toContain('aria-expanded="false"');
		const panel = new RegExp(`<section[^>]*id="${controls}"[^>]*>`).exec(html)![0];
		expect(panel).toContain('role="dialog"');
		expect(panel).toContain('hidden=""');
		expect(panel).toContain('tabindex="-1"');
		const titleId = /aria-labelledby="([^"]+)"/.exec(panel)![1];
		expect(html).toContain(`<h2 id="${titleId}"`);
	});

	it('has a labelled close button inside the dialog', () => {
		const html = render(readyStore().getSnapshot());

		expect(button(html, 'Close navigation help')).toMatch(/^<button type="button"/);
		expect(html.indexOf('role="dialog"')).toBeLessThan(html.indexOf('Close navigation help'));
	});

	it('offers Mouse, Touch and Controls as tabs, with one panel each and the labels as names', () => {
		const html = render(readyStore().getSnapshot());
		const tabs = [...html.matchAll(/<button[^>]*role="tab"[^>]*>([^<]*)<\/button>/g)];

		expect(tabs.map((tab) => tab[1])).toEqual(['Mouse', 'Touch', 'Controls']);
		expect(html.match(/role="tablist"/g)).toHaveLength(1);
		expect(html.match(/role="tabpanel"/g)).toHaveLength(3);
		for (const [markup] of tabs) {
			const panel = /aria-controls="([^"]+)"/.exec(markup)![1];
			expect(html).toContain(`id="${panel}" aria-labelledby=`);
		}
	});

	it('selects the Mouse tab until the browser reports a coarse pointer, and shows only that panel', () => {
		const html = render(readyStore().getSnapshot());

		expect(html.match(/aria-selected="true"/g)).toHaveLength(1);
		expect(/role="tab"[^>]*aria-selected="true"[^>]*>Mouse</.test(html)).toBe(true);
		expect(html.match(/role="tabpanel"[^>]*\shidden=""/g)).toHaveLength(2);
		expect(html.match(/tabindex="-1"[^>]*class="[^"]*"[^>]*>(Touch|Controls)</g)).toHaveLength(2);
	});

	it('draws every row with a decorative icon, an action and a short description', () => {
		const guide = navigationGuide(MOUNTAIN);

		for (const { rows } of Object.values(guide)) {
			for (const row of rows) {
				expect(row.action.length).toBeGreaterThan(0);
				expect(row.description.length).toBeLessThanOrEqual(40);
			}
		}
		const html = render(readyStore().getSnapshot());
		expect(html.match(/<li[^>]*><svg[^>]*aria-hidden="true"/g)?.length).toBeGreaterThan(8);
	});

	it('explains moving, zooming, tilting and turning for each input', () => {
		const { mouse, touch } = navigationGuide(MOUNTAIN);

		expect(mouse.rows.map((row) => row.action)).toEqual(['Move', 'Zoom', 'Tilt & rotate']);
		expect(touch.rows.map((row) => row.action)).toEqual(['Move', 'Zoom', 'Tilt', 'Turn']);
		expect(mouse.rows.map((row) => row.description)).toEqual([
			'Drag the globe',
			'Scroll, or right-drag',
			'Ctrl + drag'
		]);
	});

	it('offers opening a mountain on both gesture tabs only where markers are drawn', () => {
		const atlas = navigationGuide(ATLAS);
		const hidden = navigationGuide({ ...ATLAS, markersHidden: true });

		expect(atlas.mouse.rows.at(-1)).toMatchObject({ action: 'Open' });
		expect(atlas.touch.rows.at(-1)).toMatchObject({ action: 'Open' });
		expect(atlas.mouse.note).toBe('Where points overlap, a short list opens.');
		for (const guide of [navigationGuide(MOUNTAIN), hidden]) {
			expect(guide.mouse.rows.map((row) => row.action)).not.toContain('Open');
			expect(guide.touch.rows.map((row) => row.action)).not.toContain('Open');
			expect(guide.mouse.note).toBeUndefined();
		}
	});
});

describe('StageControls help controls', () => {
	const controls = (context: NavigationHelpContext) =>
		navigationGuide(context).controls.rows.map((row) => row.action);

	it('lists every atlas control, with the atlas overview as what Reset returns to', () => {
		expect(controls(ATLAS)).toEqual(['+ and −', 'Reset view', 'Rotation', 'Markers', 'Fullscreen']);
		expect(navigationGuide(ATLAS).controls.rows[1]!.description).toBe('Back to the Atlas overview');
	});

	it('lists every mountain control, with the orbit and a note on how it stops', () => {
		const { controls: mountain } = navigationGuide(MOUNTAIN);

		expect(mountain.rows.map((row) => row.action)).toEqual([
			'+ and −',
			'Reset view',
			'360° orbit',
			'Fullscreen'
		]);
		expect(mountain.rows[1]!.description).toBe('Back to the starting view');
		expect(mountain.note).toBe('Moving the map yourself stops the orbit.');
		expect(mountain.rows.map((row) => row.action)).not.toContain('Take over');
	});

	it('drops the lines of controls that are not there', () => {
		expect(controls({ ...ATLAS, rotation: false })).not.toContain('Rotation');
		expect(controls({ ...ATLAS, fullscreen: false })).not.toContain('Fullscreen');
		expect(controls({ ...MOUNTAIN, fullscreen: false })).not.toContain('Fullscreen');
		expect(controls({ ...MOUNTAIN, orbit: false, fullscreen: false })).toEqual([
			'+ and −',
			'Reset view'
		]);
		expect(navigationGuide({ ...MOUNTAIN, orbit: false }).controls.note).toBeUndefined();
	});

	it('offers showing the markers while they are hidden, and says where mountains remain', () => {
		const hidden = navigationGuide({ ...ATLAS, markersHidden: true }).controls;

		expect(hidden.rows.find((row) => row.action === 'Markers')!.description).toBe(
			'Show the mountain markers'
		);
		expect(hidden.note).toBe(
			'Markers are hidden. Every mountain is still in the list and in Search.'
		);
		expect(navigationGuide(ATLAS).controls.note).toBeUndefined();
	});

	it('keeps atlas controls out of a mountain guide and mountain controls out of the atlas guide', () => {
		const store = readyStore();
		store.setMountainOrbit('idle');
		const mountain = render(store.getSnapshot(), SUPPORTED, undefined, () => {});
		const atlasStore = readyStore();
		atlasStore.setRotation('rotating');
		const atlas = render(atlasStore.getSnapshot(), SUPPORTED, SHOWN);
		const guideOf = (html: string) =>
			html.slice(html.indexOf('role="dialog"'), html.indexOf('role="dialog"') + 6000);

		expect(guideOf(mountain)).not.toMatch(/Atlas overview|markers|Rotation|point or name/i);
		expect(guideOf(atlas)).not.toMatch(/orbit|starting view|summit/i);
		expect(guideOf(atlas)).toContain('Back to the Atlas overview');
		expect(guideOf(mountain)).toContain('Circle the summit');
	});

	it('omits the orbit where the stage offers none', () => {
		const html = render(readyStore().getSnapshot(), SUPPORTED);

		expect(html.slice(html.indexOf('role="dialog"'))).not.toMatch(/360° orbit|stops the orbit/);
	});
});

describe('StageControls tooltips', () => {
	const tooltips = (html: string) =>
		[
			...html.matchAll(
				/<span aria-hidden="true" class="[^"]*" data-side="[^"]*" data-visible="false">([^<]*)<\/span>/g
			)
		].map((match) => match[1]);

	it('gives every control one hidden tooltip with the action it performs', () => {
		const store = readyStore();
		store.setMountainOrbit('idle');
		store.setRotation('rotating');
		const html = render(store.getSnapshot(), SUPPORTED, SHOWN, () => {});

		expect(tooltips(html)).toEqual([
			'Zoom in — Move closer',
			'Zoom out — Move farther away',
			'View navigation instructions',
			'Reset to the original view',
			'Pause globe rotation',
			'Start 360° orbit',
			'Hide mountain markers',
			'Enter fullscreen'
		]);
	});

	it('keeps tooltips out of the accessibility tree and out of every accessible name', () => {
		const html = render(readyStore().getSnapshot(), SUPPORTED, SHOWN);

		expect(html).not.toMatch(/\stitle="/);
		expect(html.match(/<span aria-hidden="true" class="[^"]*" data-side/g)).toHaveLength(
			tooltips(html).length
		);
		for (const text of tooltips(html)) {
			expect(button(html, 'Reset view')).not.toContain(text);
		}
	});

	it('follows the state of each toggle', () => {
		const store = readyStore();
		store.setRotation('paused');
		store.setMountainOrbit('orbiting');
		expect(
			tooltips(
				render(
					store.getSnapshot(),
					{ supported: true, active: true, toggle: () => {} },
					HIDDEN,
					() => {}
				)
			)
		).toEqual(
			expect.arrayContaining([
				'Resume globe rotation',
				'Pause 360° orbit',
				'Show mountain markers',
				'Exit fullscreen'
			])
		);

		store.setMountainOrbit('paused');
		expect(tooltips(render(store.getSnapshot(), UNSUPPORTED, undefined, () => {}))).toContain(
			'Resume 360° orbit'
		);
	});

	it('explains a control that is not available yet, in place of its action', () => {
		const store = readyStore();
		store.setSettled(false);
		store.setMountainOrbit('unavailable');
		const texts = tooltips(render(store.getSnapshot(), UNSUPPORTED, undefined, () => {}));

		expect(texts.filter((text) => text === 'Available once the view settles')).toHaveLength(4);
		expect(texts).toContain('View navigation instructions');
	});
});

describe('StageControls fullscreen', () => {
	it('offers no fullscreen control when the browser cannot provide it', () => {
		expect(render(readyStore().getSnapshot())).not.toMatch(/fullscreen/i);
	});

	it('offers entering fullscreen beside Reset when supported', () => {
		const html = render(readyStore().getSnapshot(), SUPPORTED);

		expect(html).toContain('Enter fullscreen');
		expect(html.indexOf('Reset view')).toBeLessThan(html.indexOf('Enter fullscreen'));
	});

	it('offers leaving fullscreen while the stage is fullscreen', () => {
		const html = render(readyStore().getSnapshot(), { ...SUPPORTED, active: true });

		expect(html).toContain('Exit fullscreen');
		expect(html).not.toContain('Enter fullscreen');
	});

	it('renders no fullscreen control over a stage without a ready globe', () => {
		const store = readyStore();
		store.setState({ status: 'loading' });

		expect(render(store.getSnapshot(), SUPPORTED)).toBe('');
	});
});

describe('StageControls globe rotation', () => {
	it('offers no rotation control where the globe cannot turn by itself', () => {
		const html = render(readyStore().getSnapshot());

		expect(html).not.toMatch(/globe rotation|Rotate the globe/);
	});

	it('offers pausing while the globe turns, and turning it again once paused', () => {
		const store = readyStore();
		store.setRotation('rotating');
		expect(render(store.getSnapshot())).toContain('Pause globe rotation');

		store.setRotation('paused');
		const paused = render(store.getSnapshot());
		expect(paused).toContain('Rotate the globe');
		expect(paused).not.toContain('Pause globe rotation');
	});

	it('renders no rotation control over a globe that is not ready', () => {
		const store = readyStore();
		store.setRotation('rotating');
		store.setState({ status: 'loading' });

		expect(render(store.getSnapshot())).toBe('');
	});
});

describe('StageControls marker visibility', () => {
	it('offers no switch off the atlas', () => {
		const html = render(readyStore().getSnapshot(), SUPPORTED);

		expect(html).not.toMatch(/mountain markers/i);
	});

	it('offers hiding while the markers are drawn, as a plain button named for the action', () => {
		const html = render(readyStore().getSnapshot(), UNSUPPORTED, SHOWN);

		expect(button(html, 'Hide mountain markers')).toMatch(/^<button type="button"/);
		expect(html).not.toContain('Show mountain markers');
	});

	it('offers showing them again once hidden, still enabled', () => {
		const html = render(readyStore().getSnapshot(), UNSUPPORTED, HIDDEN);
		const control = button(html, 'Show mountain markers');

		expect(control).not.toContain('disabled');
		expect(html).not.toContain('Hide mountain markers');
	});

	it('names the action in its label alone, with no pressed state to contradict it', () => {
		for (const toggle of [SHOWN, HIDDEN]) {
			const html = render(readyStore().getSnapshot(), UNSUPPORTED, toggle);

			expect(html).not.toContain('aria-pressed');
		}
	});

	it('strikes the pin through only while the markers are hidden', () => {
		const strike = 'M4 4l16 16';
		const shown = button(render(readyStore().getSnapshot(), UNSUPPORTED, SHOWN), 'Hide mountain');
		const hidden = button(render(readyStore().getSnapshot(), UNSUPPORTED, HIDDEN), 'Show mountain');

		expect(shown).not.toContain(strike);
		expect(hidden).toContain(strike);
	});

	it('stays available while the scene is settling, like Reset and the help', () => {
		const store = readyStore();
		store.setSettled(false);

		expect(button(render(store.getSnapshot(), UNSUPPORTED, HIDDEN), 'Show mountain')).not.toContain(
			'disabled'
		);
	});

	it('sits in the toolbar after Reset and before fullscreen', () => {
		const html = render(readyStore().getSnapshot(), SUPPORTED, SHOWN);

		expect(html.indexOf('Reset view')).toBeLessThan(html.indexOf('Hide mountain markers'));
		expect(html.indexOf('Hide mountain markers')).toBeLessThan(html.indexOf('Enter fullscreen'));
	});

	it('is not drawn over a globe that is not ready', () => {
		const store = readyStore();
		store.setState({ status: 'loading' });

		expect(render(store.getSnapshot(), SUPPORTED, SHOWN)).toBe('');
	});
});

describe('StageControls mountain orbit', () => {
	const toggle = () => {};

	function withOrbit(state: SceneSnapshot['mountainOrbit']): SceneSnapshot {
		const store = readyStore();
		store.setMountainOrbit(state);
		return store.getSnapshot();
	}

	it('offers no orbit where there is no mountain to circle, such as the atlas', () => {
		const html = render(withOrbit('off'), SUPPORTED, SHOWN, toggle);

		expect(html).not.toMatch(/mountain orbit/i);
	});

	it('offers no orbit on a stage that does not ask for one', () => {
		expect(render(withOrbit('idle'))).not.toMatch(/mountain orbit/i);
	});

	it('names the action for each state, as a plain button with no pressed state', () => {
		const labels = {
			idle: 'Start mountain orbit',
			orbiting: 'Pause mountain orbit',
			paused: 'Resume mountain orbit'
		} as const;

		for (const [state, label] of Object.entries(labels)) {
			const html = render(withOrbit(state as keyof typeof labels), UNSUPPORTED, undefined, toggle);
			const control = button(html, label);

			expect(control).toMatch(/^<button type="button"/);
			expect(control).not.toContain('disabled');
			expect(control).not.toContain('aria-pressed');
			expect(html.match(/mountain orbit/g)).toHaveLength(1);
		}
	});

	it('shows the pause bars only while orbiting', () => {
		const bars = 'M9 6v12M15 6v12';

		expect(
			button(render(withOrbit('orbiting'), UNSUPPORTED, undefined, toggle), 'Pause')
		).toContain(bars);
		expect(
			button(render(withOrbit('paused'), UNSUPPORTED, undefined, toggle), 'Resume')
		).not.toContain(bars);
	});

	it('is shown but disabled while the mountain is still being presented', () => {
		const html = render(withOrbit('unavailable'), UNSUPPORTED, undefined, toggle);

		expect(button(html, 'Start mountain orbit')).toContain('disabled');
	});

	it('sits in the toolbar after Reset and before fullscreen', () => {
		const html = render(withOrbit('idle'), SUPPORTED, undefined, toggle);

		expect(html.indexOf('Reset view')).toBeLessThan(html.indexOf('Start mountain orbit'));
		expect(html.indexOf('Start mountain orbit')).toBeLessThan(html.indexOf('Enter fullscreen'));
	});

	it('is not drawn over a globe that is not ready', () => {
		const store = readyStore();
		store.setMountainOrbit('idle');
		store.setState({ status: 'loading' });

		expect(render(store.getSnapshot(), UNSUPPORTED, undefined, toggle)).toBe('');
	});
});
