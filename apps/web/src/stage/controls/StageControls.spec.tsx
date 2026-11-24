import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SceneSnapshot } from '../SceneStore';
import { SceneStore } from '../SceneStore';
import type { StageFullscreen } from '../useStageFullscreen';
import { navigationHelpSections } from './NavigationHelp';
import { StageControls, type MarkerToggle } from './StageControls';

const READING = { label: '2 km', meters: 2000, widthPx: 96 };

const UNSUPPORTED: StageFullscreen = { supported: false, active: false, toggle: () => {} };

const SHOWN: MarkerToggle = { shown: true, onToggle: () => {} };
const HIDDEN: MarkerToggle = { shown: false, onToggle: () => {} };

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

		expect(html.match(/<button/g)).toHaveLength(5);
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

	it('lists pointer gestures first unless the device has a coarse pointer', () => {
		const headings = (touchFirst: boolean) =>
			navigationHelpSections(touchFirst).map((section) => section.heading);

		expect(headings(false)).toEqual(['Mouse and trackpad', 'Touch', 'Buttons']);
		expect(headings(true)).toEqual(['Touch', 'Mouse and trackpad', 'Buttons']);
	});

	it('explains moving, zooming, tilting and turning for each input', () => {
		const [pointer, touch, buttons] = navigationHelpSections(false);

		expect(pointer!.gestures.map((g) => g.action)).toEqual(['Move', 'Zoom', 'Tilt and turn']);
		expect(touch!.gestures.map((g) => g.action)).toEqual(['Move', 'Zoom', 'Tilt', 'Turn']);
		expect(buttons!.gestures.map((g) => g.action)).toEqual(['+ and −', 'Reset view']);
	});

	it('explains opening mountains from the globe first, only where it carries markers', () => {
		const headings = (touchFirst: boolean, markers: boolean) =>
			navigationHelpSections(touchFirst, markers).map((section) => section.heading);

		expect(headings(false, true)).toEqual(['Mountains', 'Mouse and trackpad', 'Touch', 'Buttons']);
		expect(headings(true, true)).toEqual(['Mountains', 'Touch', 'Mouse and trackpad', 'Buttons']);
		expect(headings(false, false)).not.toContain('Mountains');
	});

	it('tells how to open a mountain, what overlapping points do, and where else to find it', () => {
		const html = render(readyStore().getSnapshot(), UNSUPPORTED, SHOWN);

		expect(html).toContain('Click or tap a mountain&#x27;s point or name.');
		expect(html).toContain('pick one from the short list that opens');
		expect(html).toContain('Every mountain is also in the list and in Search.');
		expect(render(readyStore().getSnapshot())).not.toContain('point or name');
	});

	it('says how to bring hidden markers back, and where mountains remain, in place of the opening text', () => {
		const html = render(readyStore().getSnapshot(), UNSUPPORTED, HIDDEN);

		expect(html).toContain('Press the pin button');
		expect(html).toContain('Every mountain is still in the list and in Search.');
		expect(html).not.toContain('point or name');
		expect(navigationHelpSections(false, true, true).map((section) => section.heading)).toEqual([
			'Mountains',
			'Mouse and trackpad',
			'Touch',
			'Buttons'
		]);
	});

	it('keeps the visible-marker help as it was', () => {
		const html = render(readyStore().getSnapshot(), UNSUPPORTED, SHOWN);

		expect(html).toContain('Click or tap a mountain&#x27;s point or name.');
		expect(html).not.toContain('Press the pin button');
	});

	it('renders the help content without the browser', () => {
		const html = render(readyStore().getSnapshot());

		expect(html).toContain('Pinch with two fingers.');
		expect(html).toContain('Hold Ctrl and drag');
	});
});

describe('StageControls fullscreen', () => {
	const SUPPORTED: StageFullscreen = { supported: true, active: false, toggle: () => {} };

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
	const SUPPORTED: StageFullscreen = { supported: true, active: false, toggle: () => {} };

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
	const SUPPORTED: StageFullscreen = { supported: true, active: false, toggle: () => {} };
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
