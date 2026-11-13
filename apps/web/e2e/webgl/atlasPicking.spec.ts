import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import { overlapping } from './support/atlas';
import {
	ACONCAGUA,
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

const DESKTOP = { width: 1280, height: 800 };
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
const atlasLink = (page: Page) =>
	page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Atlas' });

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

// The gap and margin the chooser keeps from the point pressed and the stage edges, in CSS pixels.
const CHOOSER_GAP = 12;
const CHOOSER_MARGIN = 8;

interface Box {
	x: number;
	y: number;
	width: number;
	height: number;
}

/**
 * The chooser sits against the point that opened it, on the page and not merely inside the stage:
 * a gap above or below it where either has room, centred on it unless the stage edge pushes it
 * aside, and inside the stage either way. Compares boxes measured by the browser with the point
 * the test pressed, so a frame mix-up between the canvas and the chooser's container shows as a
 * displacement.
 */
async function expectBeside(page: Page, pressed: Point) {
	const box = (await chooser(page).boundingBox()) as Box;
	// In fullscreen the stage is the fullscreen element, which the page's stage anchor lies outside.
	const stage = await page.evaluate<Box>(() => {
		const frame = document.fullscreenElement ?? document.querySelector('[data-stage]')!;
		const { x, y, width, height } = frame.getBoundingClientRect();

		return { x, y, width, height };
	});
	const right = box.x + box.width;
	const bottom = box.y + box.height;

	expect(box.x).toBeGreaterThanOrEqual(stage.x + CHOOSER_MARGIN - 1);
	expect(right).toBeLessThanOrEqual(stage.x + stage.width - CHOOSER_MARGIN + 1);
	expect(box.y).toBeGreaterThanOrEqual(stage.y + CHOOSER_MARGIN - 1);
	expect(bottom).toBeLessThanOrEqual(stage.y + stage.height - CHOOSER_MARGIN + 1);

	const roomBelow =
		stage.y + stage.height - CHOOSER_MARGIN - (pressed.y + CHOOSER_GAP) >= box.height;
	const roomAbove = pressed.y - CHOOSER_GAP - (stage.y + CHOOSER_MARGIN) >= box.height;
	if (roomBelow || roomAbove) {
		const gap = roomBelow ? box.y - pressed.y : pressed.y - bottom;
		expect(Math.abs(gap - CHOOSER_GAP)).toBeLessThan(1.5);
	}
	const pushed =
		box.x <= stage.x + CHOOSER_MARGIN + 1 || right >= stage.x + stage.width - CHOOSER_MARGIN - 1;
	if (!pushed) {
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

async function overviewAtRest(page: Page) {
	await page.goto('/atlas');
	await expectReadyStage(page);
	await expect
		.poll(async () => (await globePosition(page))?.orbiting, { timeout: 30_000 })
		.toBe(true);
	await page.getByRole('button', { name: 'Pause globe rotation' }).click();
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

test.describe('@webgl @lifecycle atlas marker activation', () => {
	test('a marker opens its mountain once, as one history entry, again after Back, on one Viewer', async ({
		page,
		probe
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expect
			.poll(async () => (await globePosition(page))?.orbiting, { timeout: 30_000 })
			.toBe(true);
		const entries = await historyLength(page);
		const olympus = await shown(page, OLYMPUS.slug);
		expect(nearestOther(await layer(page), olympus.window, OLYMPUS.slug)).toBeGreaterThan(
			MOUSE_REACH + MOUSE_CLEARANCE
		);

		await clickCanvas(page, olympus.window);

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(chooser(page)).toHaveCount(0);
		await expect.poll(async () => (await layer(page)).shown).toBe(false);
		await expectCanonicalPose(page, OLYMPUS.camera);
		expect(await historyLength(page)).toBe(entries + 1);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });

		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await expect.poll(async () => (await layer(page)).shown).toBe(true);
		await cameraAtRest(page);
		await clickCanvas(page, (await shown(page, OLYMPUS.slug)).window);

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expectCanonicalPose(page, OLYMPUS.camera);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});
});

test.describe('@webgl atlas marker gestures', () => {
	test('points at a marker, tells a click from a drag, and keeps working across a flight', async ({
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
			await framesPass(page, 10);

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

		await test.step('the atlas interrupting a mountain flight leaves the markers working', async () => {
			await clickCanvas(page, (await shown(page, OLYMPUS.slug)).window);
			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));

			await atlasLink(page).click();
			await expect(page).toHaveURL(/\/atlas$/);
			// The reader paused the rotation, and the pause holds across visits: the overview stays put.
			await expect(page.getByRole('button', { name: 'Rotate the globe' })).toBeVisible();
			await expect.poll(async () => (await layer(page)).shown).toBe(true);
			await cameraAtRest(page);
			await clickCanvas(page, (await shown(page, OLYMPUS.slug)).window);

			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expectCanonicalPose(page, OLYMPUS.camera);
		});

		await test.step('a mountain page opens nothing from a click on its globe', async () => {
			const box = (await canvas(page).boundingBox())!;

			await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
			await framesPass(page, 10);

			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expect(chooser(page)).toHaveCount(0);
			expect(await layer(page)).toMatchObject({ shown: false });
			expect(await canvas(page).evaluate((element) => getComputedStyle(element).cursor)).toBe(
				'auto'
			);
		});

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});
});

test.describe('@webgl atlas marker chooser', () => {
	test('asks which mountain where markers merge, places itself beside the press and dismisses cleanly', async ({
		page,
		probe
	}) => {
		const enterFullscreen = async () => {
			await page.getByRole('button', { name: 'Enter fullscreen' }).click();
			await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true);
			await cameraAtRest(page);
		};
		await overviewAtRest(page);
		const everest = (await shown(page, 'mount-everest')).window;

		await test.step('the Himalaya merge: nearest and highest first, focus on the first, Escape closes', async () => {
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
			await expect(links.first()).toHaveText('Mount Everest');
			await expect(links.first()).toBeFocused();
			await expect(links.first()).toHaveAttribute('href', '/mountains/mount-everest');
			await expectBeside(page, await onPage(page, everest));
			await page.keyboard.press('Tab');
			await expect(links.nth(1)).toBeFocused();

			await page.keyboard.press('Escape');
			await expect(dialog).toHaveCount(0);
			await expect(page.locator('[data-stage]')).toBeFocused();
			await expect(page).toHaveURL(/\/atlas$/);
		});

		await test.step('it closes on a press elsewhere, on a wheel and on its Close button', async () => {
			await clickCanvas(page, everest);
			await expect(chooser(page)).toBeVisible();
			await page.getByRole('heading', { name: 'Atlas', level: 1 }).click();
			await expect(chooser(page)).toHaveCount(0);

			await clickCanvas(page, everest);
			await expect(chooser(page)).toBeVisible();
			await page.mouse.wheel(0, 100);
			await expect(chooser(page)).toHaveCount(0);
			await cameraAtRest(page);

			await clickCanvas(page, (await shown(page, 'mount-everest')).window);
			await expect(chooser(page)).toBeVisible();
			await page.getByRole('button', { name: 'Close the list of mountains' }).click();
			await expect(chooser(page)).toHaveCount(0);
			await expect(page).toHaveURL(/\/atlas$/);
		});

		await test.step('it closes when fullscreen changes the stage, and opens beside the press inside it', async () => {
			const here = (await shown(page, 'mount-everest')).window;
			await clickCanvas(page, here);
			await expect(chooser(page)).toBeVisible();

			await enterFullscreen();
			await expect(chooser(page)).toHaveCount(0);

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
			await page.locator('[data-stage]').evaluate((element) => {
				element.style.height = '';
			});
			await cameraAtRest(page);
		});

		await test.step('choosing a mountain opens it and leaves no chooser behind on Back', async () => {
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
			await expect(dialog.getByRole('link')).toHaveText([ACONCAGUA.name, 'Cerro El Plata']);
			await dialog.getByRole('link', { name: ACONCAGUA.name }).click();

			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
			await expect(chooser(page)).toHaveCount(0);
			await expectCanonicalPose(page, ACONCAGUA.camera);

			await page.goBack();
			await expect(page).toHaveURL(/\/atlas$/);
			await expect.poll(async () => (await layer(page)).shown).toBe(true);
			await expect(chooser(page)).toHaveCount(0);
		});

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});
});

test.describe('@webgl atlas close neighbours', () => {
	// Fitz Roy and Cerro Torre stand 4.6 km apart: one dot from afar, one name regionally, two
	// names and two separate targets up close. The camera closes in by wheel steps on Fitz Roy.
	test('Fitz Roy and Cerro Torre: a choice, then two targets, then two names', async ({
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
		const closer = async (until: (state: Awaited<ReturnType<typeof pair>>) => boolean) => {
			let state = await pair();
			for (let step = 0; step < 40 && !until(state); step += 1) {
				await page.mouse.move(box.x + state.roy.window.x, box.y + state.roy.window.y);
				await page.mouse.wheel(0, -250);
				await framesPass(page, 8);
				expect(overlapping(await layer(page))).toEqual([]);
				state = await pair();
			}
			await cameraAtRest(page);
			expect(overlapping(await layer(page))).toEqual([]);
			return pair();
		};

		const merged = await closer(({ roy }) => roy.labelShown);
		expect(distance(merged.roy.window, merged.torre.window)).toBeLessThan(MOUSE_CLEARANCE);
		expect(merged.torre.labelSuppressed).toBe(true);
		await clickCanvas(page, merged.roy.window);
		await expect(chooser(page).getByRole('link')).toHaveText(['Fitz Roy', 'Cerro Torre']);
		await page.keyboard.press('Escape');
		await expect(chooser(page)).toHaveCount(0);

		const apart = await closer(
			({ roy, torre }) => distance(roy.window, torre.window) > 2 * MOUSE_REACH
		);
		for (const target of [apart.torre, apart.roy]) {
			const at = await onPage(page, target.window);
			await page.mouse.move(at.x, at.y);
			await expect.poll(async () => (await layer(page)).hovered).toBe(target.slug);
		}

		const named = await closer(({ roy, torre }) => roy.labelShown && torre.labelShown);
		expect([named.roy.labelSuppressed, named.torre.labelSuppressed]).toEqual([false, false]);

		await clickCanvas(page, named.torre.window);
		await expect(page).toHaveURL(/\/mountains\/cerro-torre$/);
	});
});

test.describe('@webgl atlas markers by touch', () => {
	test.use({ viewport: PHONE, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });

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
			await expect(dialog.getByRole('link').first()).toHaveText('Mount Everest');

			const heading = (await page.getByRole('heading', { name: 'Atlas', level: 1 }).boundingBox())!;
			await page.touchscreen.tap(heading.x + 10, heading.y + heading.height / 2);
			await expect(dialog).toHaveCount(0);
			await expect(page).toHaveURL(/\/atlas$/);
		});
	});
});
