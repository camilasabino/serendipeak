import type { Page } from '@playwright/test';
import { ATLAS_MARKER_STYLE } from '../../src/stage/globe/atlasMarkers';
import { resolveMarkerHit, type HitTarget } from '../../src/stage/globe/markerHits';
import { resetStub, useScenario } from '../ssr/support';
import { overlapping } from './support/atlas';
import {
	ACONCAGUA,
	DESKTOP,
	OLYMPUS,
	atlasLayer,
	cameraAtRest,
	dragGlobe,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	framesPass,
	globePosition,
	liveViewers,
	test,
	type AtlasLayerReading,
	type AtlasMarkerReading
} from './support/stage';

const PHONE = { width: 390, height: 844 };

// The hit areas the picker documents, in CSS pixels.
const MOUSE_REACH = 12;
const FINGER_REACH = 22;
const MOUSE_CLEARANCE = 4;

interface Point {
	x: number;
	y: number;
}

const chooser = (page: Page) => page.getByRole('dialog', { name: 'Which mountain?' });
const canvas = (page: Page) => page.locator('main canvas');

// A chooser link reads as its mountain and its elevation, such as "Mount Everest 8,849 m".
const ENTRY = /^.+ \d[\d,]* m$/;

/**
 * Every entry names its mountain and elevation, and the names run alphabetically, whatever the
 * order of distance from the press; the first is the one that took focus.
 */
async function expectAlphabetical(page: Page): Promise<string[]> {
	const links = chooser(page).getByRole('link');
	for (const text of await links.allTextContents()) {
		expect(text).toMatch(ENTRY);
	}
	const names = await links.evaluateAll((anchors) =>
		anchors.map((anchor) => anchor.firstElementChild?.textContent ?? '')
	);
	const collator = new Intl.Collator('en', { sensitivity: 'base' });
	expect(names).toEqual([...names].sort((a, b) => collator.compare(a, b)));
	await expect(links.first()).toBeFocused();

	return names;
}

async function layer(page: Page): Promise<AtlasLayerReading> {
	const reading = await atlasLayer(page);
	expect(reading).toBeDefined();
	return reading!;
}

async function shown(page: Page, slug: string): Promise<AtlasMarkerReading & { window: Point }> {
	const found = (await layer(page)).markers.find((entry) => entry.slug === slug);
	expect(found?.visible, `${slug} drawn`).toBe(true);
	return found as AtlasMarkerReading & { window: Point };
}

/** Where a canvas point is on the page. */
async function onPage(page: Page, point: Point): Promise<Point> {
	const box = (await canvas(page).boundingBox())!;
	return { x: box.x + point.x, y: box.y + point.y };
}

async function clickCanvas(page: Page, point: Point) {
	const at = await onPage(page, point);
	await page.mouse.click(at.x, at.y);
}

async function tapCanvas(page: Page, point: Point) {
	const at = await onPage(page, point);
	await page.touchscreen.tap(at.x, at.y);
}

const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

// The gap and margin the chooser keeps from the point pressed and the stage edges, and the strip at
// the bottom of the stage it keeps clear for the credits where it can, in CSS pixels.
const CHOOSER_GAP = 12;
const CHOOSER_MARGIN = 8;
const CREDITS_STRIP = 40;
const CREDITS_STRIP_WRAPPED = 58;
const WRAPPED_CREDITS_STAGE = 380;

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

const stageBox = (page: Page) =>
	// In fullscreen the stage is the fullscreen element, which the page's stage anchor lies outside.
	page.evaluate<Box>(() => {
		const frame = document.fullscreenElement ?? document.querySelector('[data-stage]')!;
		const { x, y, width, height } = frame.getBoundingClientRect();

		return { x, y, width, height };
	});

/** Whether the list is cut short and scrolls, rather than showing every mountain. */
const scrolls = (page: Page) =>
	chooser(page)
		.getByRole('list')
		.evaluate((list) => list.scrollHeight > list.clientHeight);

/**
 * The chooser sits against the point that opened it, on the page and not merely inside the stage:
 * a gap above or below it where either has room, centred on it unless the stage edge pushes it
 * aside, and inside the stage either way. A list too long for the stage fills it and scrolls
 * instead. Compares boxes measured by the browser with the point the test pressed, so a frame
 * mix-up between the canvas and the chooser's container shows as a displacement.
 */
async function expectBeside(page: Page, pressed: Point) {
	const box = (await chooser(page).boundingBox()) as Box;
	const stage = await stageBox(page);
	const cut = await scrolls(page);
	const right = box.x + box.width;
	const bottom = box.y + box.height;

	expect(box.x).toBeGreaterThanOrEqual(stage.x + CHOOSER_MARGIN - 1);
	expect(right).toBeLessThanOrEqual(stage.x + stage.width - CHOOSER_MARGIN + 1);
	expect(box.y).toBeGreaterThanOrEqual(stage.y + CHOOSER_MARGIN - 1);
	expect(bottom).toBeLessThanOrEqual(stage.y + stage.height - CHOOSER_MARGIN + 1);

	const strip = stage.width < WRAPPED_CREDITS_STAGE ? CREDITS_STRIP_WRAPPED : CREDITS_STRIP;
	const clear = !cut && box.height <= stage.height - 2 * CHOOSER_MARGIN - strip ? strip : 0;
	const roomBelow =
		stage.y + stage.height - CHOOSER_MARGIN - clear - (pressed.y + CHOOSER_GAP) >= box.height;
	const roomAbove = pressed.y - CHOOSER_GAP - (stage.y + CHOOSER_MARGIN) >= box.height;
	if (!cut && (roomBelow || roomAbove)) {
		const gap = roomBelow ? box.y - pressed.y : pressed.y - bottom;
		expect(Math.abs(gap - CHOOSER_GAP)).toBeLessThan(1.5);
	}
	// Never under the fingertip: its lifting would send a click to whatever stands there.
	const under =
		pressed.x >= box.x && pressed.x <= right && pressed.y >= box.y && pressed.y <= bottom;
	expect(under, 'the chooser covers the press').toBe(false);
	const pushed =
		box.x <= stage.x + CHOOSER_MARGIN + 1 || right >= stage.x + stage.width - CHOOSER_MARGIN - 1;
	// Only a chooser above or below the press is centred on it; one beside it stands off to a side.
	const vertical = pressed.y < box.y || pressed.y > bottom;
	if (!pushed && vertical) {
		expect(Math.abs(box.x + box.width / 2 - pressed.x)).toBeLessThan(1.5);
	}
}

const describeFocus = (page: Page) =>
	page.evaluate(() => {
		const active = document.activeElement;
		const fullscreen = document.fullscreenElement;

		return {
			tag: active?.tagName,
			dataStage: active instanceof HTMLElement && active.hasAttribute('data-stage'),
			isBody: active === document.body,
			fullscreen: fullscreen !== null,
			insideFullscreen: fullscreen ? fullscreen.contains(active) : null
		};
	});

/** The nearest other drawn marker, to check a press lands where only one mountain is meant. */
function nearestOther(reading: AtlasLayerReading, point: Point, except: string): number {
	return Math.min(
		...reading.markers
			.filter((entry) => entry.visible && entry.slug !== except)
			.map((entry) => distance(entry.window!, point))
	);
}

// Under reduced motion the globe never turns, so a full load of the atlas is at rest as soon as the
// overview has been placed.
async function overviewAtRest(page: Page) {
	await page.goto('/atlas');
	await expectReadyStage(page);
	await cameraAtRest(page);
}

test.beforeEach(async ({ page, request }) => {
	await page.setViewportSize(DESKTOP);
	await useScenario(request, 'catalog');
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

const historyLength = (page: Page) => page.evaluate(() => history.length);

const orbiting = (page: Page) => globePosition(page).then((position) => position?.orbiting);

test.describe('@webgl @lifecycle atlas marker activation', () => {
	test('a marker opens its mountain once, as one history entry, again after Back, on one Viewer', async ({
		page,
		probe
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expect.poll(() => orbiting(page), { timeout: 30_000 }).toBe(true);
		const entries = await historyLength(page);
		const olympus = await shown(page, OLYMPUS.slug);
		expect(nearestOther(await layer(page), olympus.window, OLYMPUS.slug)).toBeGreaterThan(
			MOUSE_REACH + MOUSE_CLEARANCE
		);

		await clickCanvas(page, olympus.window);

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(chooser(page)).toHaveCount(0);
		await expect.poll(async () => (await layer(page)).shown).toBe(false);
		expect(await historyLength(page)).toBe(entries + 1);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });

		// The reader never paused, so coming back resumes the ambient turn: the globe is ready for a
		// click once it is turning and its markers are shown, not once it is still.
		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await expect.poll(async () => (await layer(page)).shown).toBe(true);
		await expect.poll(() => orbiting(page), { timeout: 30_000 }).toBe(true);
		await clickCanvas(page, (await shown(page, OLYMPUS.slug)).window);

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		// Going Back dropped the first entry from the forward stack, so one more click is one entry again.
		expect(await historyLength(page)).toBe(entries + 1);
		expect(await probe.contextsLive()).toBe(1);
	});
});

test.describe('@webgl atlas marker gestures', () => {
	test.use({ reducedMotion: 'reduce' });

	test('points at a marker, tells a click from a drag, and opens a mountain only from a click', async ({
		page,
		probe
	}) => {
		await overviewAtRest(page);
		const olympus = await shown(page, OLYMPUS.slug);
		const bare = { x: olympus.window.x, y: olympus.window.y + 60 };
		expect(nearestOther(await layer(page), bare, '')).toBeGreaterThan(FINGER_REACH);

		await test.step('the pointer rings the marker under it, and nothing over bare globe', async () => {
			const cursor = () => canvas(page).evaluate((element) => getComputedStyle(element).cursor);

			const over = await onPage(page, olympus.window);
			await page.mouse.move(over.x, over.y);
			await expect.poll(cursor).toBe('pointer');
			expect((await layer(page)).hovered).toBe(OLYMPUS.slug);

			const away = await onPage(page, bare);
			await page.mouse.move(away.x, away.y);
			await expect.poll(cursor).toBe('auto');
			expect((await layer(page)).hovered).toBeUndefined();
		});

		await test.step('a click on bare globe opens nothing', async () => {
			await clickCanvas(page, bare);
			await framesPass(page, 6);

			await expect(page).toHaveURL(/\/atlas$/);
			await expect(chooser(page)).toHaveCount(0);
		});

		await test.step('a drag that starts on a marker opens nothing and turns the globe', async () => {
			const start = await onPage(page, olympus.window);

			await page.mouse.move(start.x, start.y);
			await page.mouse.down();
			await page.mouse.move(start.x + 40, start.y + 10, { steps: 8 });
			await page.mouse.up();
			await cameraAtRest(page);

			await expect(page).toHaveURL(/\/atlas$/);
			await expect(chooser(page)).toHaveCount(0);
			expect((await shown(page, OLYMPUS.slug)).window.x).toBeGreaterThan(start.x - 1);
		});

		await test.step('a click on the marker opens its mountain, and that page opens nothing from a click', async () => {
			await clickCanvas(page, (await shown(page, OLYMPUS.slug)).window);
			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expectCanonicalPose(page, OLYMPUS.camera);

			const box = (await canvas(page).boundingBox())!;
			await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
			await framesPass(page, 6);

			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expect(chooser(page)).toHaveCount(0);
			expect(await layer(page)).toMatchObject({ shown: false });
		});

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.contextsLive()).toBe(1);
	});
});

test.describe('@webgl atlas marker chooser', () => {
	test.use({ reducedMotion: 'reduce' });

	test('asks which mountain where markers merge, and goes away on Escape, a press or a wheel', async ({
		page
	}) => {
		await overviewAtRest(page);
		const everest = (await shown(page, 'mount-everest')).window;

		await test.step('the Himalaya merge: alphabetical with elevations, focus on the first, Escape closes', async () => {
			const reading = await layer(page);
			const merged = reading.markers.filter(
				(entry) => entry.visible && distance(entry.window!, everest) < MOUSE_CLEARANCE
			);
			expect(merged.length).toBeGreaterThan(1);

			await clickCanvas(page, everest);

			const dialog = chooser(page);
			await expect(dialog).toBeVisible();
			const links = dialog.getByRole('link');
			await expect(links).toHaveCount(merged.length);
			expect(await expectAlphabetical(page)).toContain('Mount Everest');
			await expect(
				dialog.getByRole('link', { name: /^Mount Everest \d[\d,]* m$/ })
			).toHaveAttribute('href', '/mountains/mount-everest');
			await page.keyboard.press('Tab');
			await expect(links.nth(1)).toBeFocused();

			await page.keyboard.press('Escape');
			await expect(dialog).toHaveCount(0);
			await expect(page.locator('[data-stage]')).toBeFocused();
			await expect(page).toHaveURL(/\/atlas$/);
		});

		await test.step('it closes on a press elsewhere and on a wheel', async () => {
			await clickCanvas(page, everest);
			await expect(chooser(page)).toBeVisible();
			await page.getByRole('heading', { name: 'Atlas', level: 1 }).click();
			await expect(chooser(page)).toHaveCount(0);

			await clickCanvas(page, everest);
			await expect(chooser(page)).toBeVisible();
			await page.mouse.wheel(0, 100);
			await expect(chooser(page)).toHaveCount(0);
		});
	});

	test('choosing a mountain from the chooser opens it and leaves no chooser behind on Back', async ({
		page,
		probe
	}) => {
		await overviewAtRest(page);
		await dragGlobe(page, 0.45, -0.3);
		await cameraAtRest(page);
		const [aconcagua, plata] = [
			(await shown(page, ACONCAGUA.slug)).window,
			(await shown(page, 'cerro-el-plata')).window
		];
		const between = { x: (aconcagua.x + plata.x) / 2, y: (aconcagua.y + plata.y) / 2 };
		expect(distance(aconcagua, plata)).toBeLessThan(2 * MOUSE_REACH);

		await clickCanvas(page, between);
		const dialog = chooser(page);
		await expect(dialog.getByRole('link')).toHaveText([
			new RegExp(`^${ACONCAGUA.name} \\d[\\d,]* m$`),
			/^Cerro El Plata \d[\d,]* m$/
		]);
		await dialog.getByRole('link', { name: ACONCAGUA.name }).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await expect(chooser(page)).toHaveCount(0);

		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await expect.poll(async () => (await layer(page)).shown).toBe(true);
		await expect(chooser(page)).toHaveCount(0);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.contextsLive()).toBe(1);
	});

	test('opens beside the press in fullscreen, and closes when the stage changes under it', async ({
		page
	}) => {
		await overviewAtRest(page);
		const everest = (await shown(page, 'mount-everest')).window;

		await test.step('it closes when fullscreen changes the stage, and opens beside the press inside it', async () => {
			await clickCanvas(page, everest);
			await expect(chooser(page)).toBeVisible();
			await expectBeside(page, await onPage(page, everest));

			await page.getByRole('button', { name: 'Enter fullscreen' }).click();
			await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
			await expect(chooser(page)).toHaveCount(0);
			await cameraAtRest(page);

			const inside = (await shown(page, 'mount-everest')).window;
			await clickCanvas(page, inside);
			await expect(chooser(page)).toBeVisible();
			await expectBeside(page, await onPage(page, inside));
			await expect(chooser(page).getByRole('link').first()).toBeFocused();

			await page.keyboard.press('Escape');

			await expect(chooser(page)).toHaveCount(0);
			const focus = await describeFocus(page);
			expect(focus.isBody, JSON.stringify(focus)).toBe(false);
			if (focus.fullscreen) {
				expect(focus.insideFullscreen, JSON.stringify(focus)).toBe(true);
			}
		});

		await test.step('it closes when the stage changes shape without the window resizing', async () => {
			if (await page.evaluate(() => document.fullscreenElement !== null)) {
				await page.getByRole('button', { name: 'Exit fullscreen' }).click();
				await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
				await cameraAtRest(page);
			}
			await page.evaluate(() => {
				(window as Window & { __windowResizes?: number }).__windowResizes = 0;
				window.addEventListener('resize', () => {
					(window as Window & { __windowResizes?: number }).__windowResizes! += 1;
				});
			});
			await clickCanvas(page, (await shown(page, 'mount-everest')).window);
			await expect(chooser(page)).toBeVisible();

			await page.locator('[data-stage]').evaluate((element) => {
				element.style.height = `${element.clientHeight - 120}px`;
			});

			await expect(chooser(page)).toHaveCount(0);
			expect(
				await page.evaluate(() => (window as Window & { __windowResizes?: number }).__windowResizes)
			).toBe(0);
			await expect(page).toHaveURL(/\/atlas$/);
		});
	});
});

test.describe('@webgl atlas close neighbours', () => {
	test.use({ reducedMotion: 'reduce' });

	// Fitz Roy and Cerro Torre stand 4.6 km apart: one dot from afar, one name regionally. The
	// camera closes in by wheel steps on Fitz Roy; the closer views, where the two are told apart,
	// are pinned by the marker unit tests.
	test('Fitz Roy and Cerro Torre: a choice at regional distance, then the second one opens', async ({
		page,
		probe
	}) => {
		// The stub has no page for Cerro Torre: opening it ends on the not-found page, as intended.
		probe.tolerate({ requests: /cerro-torre/, errors: /404 \(Not Found\)/ });
		await overviewAtRest(page);
		await dragGlobe(page, 0.45, -0.3);
		await cameraAtRest(page);
		const pair = async () => ({
			roy: await shown(page, 'fitz-roy'),
			torre: await shown(page, 'cerro-torre')
		});
		const box = (await canvas(page).boundingBox())!;

		// Coarse wheel steps while the pair is far, fine ones near the distance where the name appears:
		// the dots only coincide within a narrow band of distances, which a coarse step would skip.
		let state = await pair();
		for (let step = 0; step < 40 && !state.roy.labelShown; step += 1) {
			const far = state.roy.distanceMeters > 2.5 * ATLAS_MARKER_STYLE.labelMaxMeters;
			await page.mouse.move(box.x + state.roy.window.x, box.y + state.roy.window.y);
			await page.mouse.wheel(0, far ? -900 : -250);
			await framesPass(page, 4);
			state = await pair();
		}
		await cameraAtRest(page);
		const merged = await pair();

		expect(overlapping(await layer(page))).toEqual([]);
		expect(merged.roy.labelShown).toBe(true);
		expect(distance(merged.roy.window, merged.torre.window)).toBeLessThan(MOUSE_CLEARANCE);
		expect(merged.torre.labelSuppressed).toBe(true);
		await clickCanvas(page, merged.roy.window);
		await expect(chooser(page).getByRole('link')).toHaveText([
			/^Cerro Torre \d[\d,]* m$/,
			/^Fitz Roy \d[\d,]* m$/
		]);
		await chooser(page).getByRole('link', { name: 'Cerro Torre' }).click();
		await expect(page).toHaveURL(/\/mountains\/cerro-torre$/);
	});
});

test.describe('@webgl atlas markers by touch', () => {
	test.use({
		viewport: PHONE,
		hasTouch: true,
		isMobile: true,
		deviceScaleFactor: 3,
		reducedMotion: 'reduce'
	});

	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(PHONE);
	});

	test('a tap a fingertip away opens a mountain, and the chooser stays on the screen', async ({
		page
	}) => {
		await overviewAtRest(page);

		await test.step('a tap a fingertip away from a marker opens its mountain', async () => {
			const reading = await layer(page);
			const olympus = (await shown(page, OLYMPUS.slug)).window;
			// Off the dot by more than a mouse reaches, on the side away from every neighbour.
			const offsets = [-16, 16].flatMap((dx) => [-16, 16].map((dy) => ({ dx, dy })));
			const tap = offsets
				.map(({ dx, dy }) => ({ x: olympus.x + dx * 0.75, y: olympus.y + dy * 0.75 }))
				.sort(
					(a, b) => nearestOther(reading, b, OLYMPUS.slug) - nearestOther(reading, a, OLYMPUS.slug)
				)[0]!;
			expect(distance(tap, olympus)).toBeGreaterThan(MOUSE_REACH);
			expect(nearestOther(reading, tap, OLYMPUS.slug)).toBeGreaterThan(distance(tap, olympus) + 8);

			await tapCanvas(page, tap);

			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		});

		await test.step('the chooser keeps on the phone screen and closes with a tap elsewhere', async () => {
			await page.goBack();
			await expect(page).toHaveURL(/\/atlas$/);
			await expect.poll(async () => (await layer(page)).shown).toBe(true);
			await cameraAtRest(page);
			const everest = (await shown(page, 'mount-everest')).window;

			await tapCanvas(page, everest);

			const dialog = chooser(page);
			await expect(dialog).toBeVisible();
			await expectBeside(page, await onPage(page, everest));
			const placed = (await dialog.boundingBox())!;
			const stage = (await page.locator('[data-stage]').boundingBox())!;
			expect(placed.x).toBeGreaterThanOrEqual(stage.x);
			expect(placed.x + placed.width).toBeLessThanOrEqual(
				Math.min(stage.x + stage.width, PHONE.width)
			);
			expect(placed.y).toBeGreaterThanOrEqual(stage.y);
			expect(placed.y + placed.height).toBeLessThanOrEqual(stage.y + stage.height);
			expect(await expectAlphabetical(page)).toContain('Mount Everest');

			const heading = (await page.getByRole('heading', { name: 'Atlas', level: 1 }).boundingBox())!;
			await page.touchscreen.tap(heading.x + 10, heading.y + heading.height / 2);
			await expect(dialog).toHaveCount(0);
			await expect(page).toHaveURL(/\/atlas$/);
		});
	});
});

// Phone widths from the narrowest in use up to a large phone, and a phone on its side, where the
// stage is shortest. A press at the Himalaya merge lists several mountains.
const SCREENS = [
	{ label: '320 px', width: 320, height: 640 },
	{ label: '360 px', width: 360, height: 740 },
	{ label: '390 px', width: 390, height: 844 },
	{ label: '430 px', width: 430, height: 932 },
	{ label: 'landscape 844 x 390 px', width: 844, height: 390 }
] as const;

/**
 * Where a tap asks the most "which mountain?": the drawn marker whose touch press, judged by the
 * picker's own rule on the markers as drawn, offers the longest list. The globe's size changes
 * which markers merge, so no one mountain is a safe place to press at every width.
 */
async function crowdedPoint(page: Page): Promise<Point> {
	const targets = (await layer(page)).markers.flatMap((entry): HitTarget[] =>
		entry.visible && entry.window
			? [
					{
						slug: entry.slug,
						name: entry.slug,
						elevationMeters: 0,
						...entry.window,
						label: undefined
					}
				]
			: []
	);
	let best: { at: Point; count: number } | undefined;
	for (const { x, y } of targets) {
		const hit = resolveMarkerHit(targets, { x, y }, 'coarse');
		const count = hit.kind === 'choice' ? hit.mountains.length : 0;
		if (count > (best?.count ?? 1)) {
			best = { at: { x, y }, count };
		}
	}
	expect(best, 'a place where drawn markers merge').toBeDefined();

	return best!.at;
}

// The touch target Apple and Material both ask for, in CSS pixels.
const TARGET = 44;

for (const screen of SCREENS) {
	test.describe(`@webgl atlas marker chooser on a ${screen.label} screen`, () => {
		const viewport = { width: screen.width, height: screen.height };
		test.use({
			viewport,
			hasTouch: true,
			isMobile: true,
			deviceScaleFactor: 3,
			reducedMotion: 'reduce'
		});

		test.beforeEach(async ({ page }) => {
			await page.setViewportSize(viewport);
		});

		test('stays inside the stage with its close button in view, and every entry is a full touch target', async ({
			page
		}) => {
			await overviewAtRest(page);
			const crowded = await crowdedPoint(page);

			await tapCanvas(page, crowded);

			const dialog = chooser(page);
			await expect(dialog).toBeVisible();
			await expectBeside(page, await onPage(page, crowded));
			await expectAlphabetical(page);
			const box = (await dialog.boundingBox()) as Box;
			const stage = await stageBox(page);
			expect(box.x).toBeGreaterThanOrEqual(0);
			expect(box.x + box.width).toBeLessThanOrEqual(screen.width);

			const close = dialog.getByRole('button', { name: 'Close the list of mountains' });
			const closeBox = (await close.boundingBox()) as Box;
			expect(closeBox.width).toBeGreaterThanOrEqual(TARGET - 0.5);
			expect(closeBox.height).toBeGreaterThanOrEqual(TARGET - 0.5);
			expect(closeBox.y).toBeGreaterThanOrEqual(stage.y);
			expect(closeBox.y + closeBox.height).toBeLessThanOrEqual(stage.y + stage.height);

			const links = dialog.getByRole('link');
			for (const link of await links.all()) {
				expect(((await link.boundingBox()) as Box).height).toBeGreaterThanOrEqual(TARGET - 0.5);
			}

			// Names wrap rather than run past the chooser, and the elevation keeps its own line space.
			const overflowing = await links.evaluateAll(
				(anchors) => anchors.filter((anchor) => anchor.scrollWidth > anchor.clientWidth).length
			);
			expect(overflowing).toBe(0);
			expect(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= document.documentElement.clientWidth
				)
			).toBe(true);
		});

		test('reaches every entry by keyboard while the close button stays put, and closes on Escape', async ({
			page
		}) => {
			await overviewAtRest(page);
			await tapCanvas(page, await crowdedPoint(page));
			const dialog = chooser(page);
			await expect(dialog).toBeVisible();
			const close = dialog.getByRole('button', { name: 'Close the list of mountains' });
			const links = dialog.getByRole('link');
			const closeBefore = (await close.boundingBox()) as Box;
			const cut = await scrolls(page);
			const count = await links.count();

			await links.last().focus();

			await expect(links.last()).toBeFocused();
			const list = (await dialog.getByRole('list').boundingBox()) as Box;
			const last = (await links.last().boundingBox()) as Box;
			expect(last.y).toBeGreaterThanOrEqual(list.y - 1);
			expect(last.y + last.height).toBeLessThanOrEqual(list.y + list.height + 1);
			expect(await close.boundingBox()).toEqual(closeBefore);
			if (cut) {
				expect(count).toBeGreaterThan(1);
				expect(
					await dialog.getByRole('list').evaluate((element) => element.scrollTop)
				).toBeGreaterThan(0);
			}

			await page.keyboard.press('Escape');

			await expect(dialog).toHaveCount(0);
			await expect(page).toHaveURL(/\/atlas$/);
		});
	});
}

test.describe('@webgl atlas marker chooser ghost click', () => {
	const SMALL = { width: 320, height: 460 };
	test.use({
		viewport: SMALL,
		hasTouch: true,
		isMobile: true,
		deviceScaleFactor: 3,
		reducedMotion: 'reduce'
	});

	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(SMALL);
	});

	// Where the chooser stands is the placement's business and depends on where the globe's markers
	// merge on screen; this forces the case the placement avoids, a chooser covering the whole stage,
	// so the click the browser sends when the opening tap ends always lands on one of its links.
	test('the tap that opens the chooser opens no mountain, and a later tap on an entry does', async ({
		page,
		probe
	}) => {
		// The stub has no pages for most mountains: opening one ends on the not-found page, as intended.
		probe.tolerate({ requests: /\/mountains\//, errors: /404 \(Not Found\)/ });
		await overviewAtRest(page);
		await page.addStyleTag({
			content: `[data-marker-chooser] {
				left: 0 !important; top: 0 !important; right: 0 !important; bottom: 0 !important;
				width: auto !important; max-width: none !important; max-height: none !important;
			}`
		});
		const crowded = await crowdedPoint(page);

		await tapCanvas(page, crowded);

		const dialog = chooser(page);
		await expect(dialog).toBeVisible();
		await framesPass(page, 6);
		const pressed = await onPage(page, crowded);
		const under = await page.evaluate(({ x, y }) => {
			const link = document.elementFromPoint(x, y)?.closest('[data-marker-chooser] a');

			return link?.getAttribute('href') ?? null;
		}, pressed);
		expect(under, 'a chooser link stands under the press').toMatch(/^\/mountains\//);
		await expect(page).toHaveURL(/\/atlas$/);
		await expect(dialog).toBeVisible();

		const link = (await dialog.getByRole('link').first().boundingBox()) as Box;
		await page.touchscreen.tap(link.x + link.width / 2, link.y + link.height / 2);

		await expect(page).toHaveURL(/\/mountains\/[^/]+$/);
	});
});
