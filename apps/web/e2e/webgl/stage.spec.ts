import type { Locator, Page } from '@playwright/test';
import {
	ACONCAGUA,
	OLYMPUS,
	atlasLayer,
	cameraReading,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	expectedDisplayRange,
	liveViewers,
	test
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const SQUARE = { width: 1000, height: 1000 };
const PHONE = { width: 375, height: 667 };

// Strict Mode runs effects twice only in development; production mounts once.
const STRICT_MODE = process.env.WEBGL_SERVER !== 'production';

const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const COMPASS = /^Compass\. Looking \d+ degrees \w+\.$/;

const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset view' });
const zoomIn = (page: Page) => page.getByRole('button', { name: 'Zoom in' });
const helpTrigger = (page: Page) => page.getByRole('button', { name: 'How to navigate' });
const helpPanel = (page: Page) => page.getByRole('dialog', { name: 'How to navigate' });

async function box(locator: Locator) {
	const found = await locator.boundingBox();
	expect(found).not.toBeNull();
	return found!;
}

function overlaps(a: { x: number; y: number; width: number; height: number }, b: typeof a) {
	return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function pushRoute(page: Page, url: string) {
	await page.evaluate((target) => {
		void (
			window as Window & { next?: { router: { push(url: string): Promise<boolean> } } }
		).next!.router.push(target);
	}, url);
}

async function tagCanvas(page: Page) {
	await page.evaluate(() => document.querySelector('canvas')?.setAttribute('data-probe', 'first'));
}

async function openPermalink(page: Page, viewport = DESKTOP) {
	await page.setViewportSize(viewport);
	await page.goto(PERMALINK);
	await expectReadyStage(page);
	await expectCanonicalPose(page, ACONCAGUA.camera);
}

test.describe('@webgl @lifecycle stage boot', () => {
	test('boots one Viewer on the canonical pose, with the stage controls and no atlas layer', async ({
		page,
		probe
	}) => {
		await openPermalink(page);

		const reading = (await cameraReading(page))!;
		expect(reading.displayRangeMeters).toBeCloseTo(
			expectedDisplayRange(ACONCAGUA.camera.rangeMeters, reading.stage),
			-1
		);
		const stageBox = await page.locator('canvas').first().boundingBox();
		expect(reading.stage.width).toBeCloseTo(stageBox!.width, -1);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
		expect(await probe.stageObservers()).toEqual({ observed: STRICT_MODE ? 2 : 1, live: 1 });
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		expect(await atlasLayer(page)).toMatchObject({ shown: false, layers: 0, entities: 0 });

		await expect(page.locator('.cesium-viewer-toolbar button, .cesium-button')).toHaveCount(0);
		await expect(
			page.locator('.cesium-navigation-help-button, .cesium-navigation-help')
		).toHaveCount(0);
		await expect(page.locator('.cesium-viewer-fullscreenContainer')).toHaveCount(0);
		await expect(
			page.locator('.cesium-credit-lightbox-overlay, .cesium-credit-logoContainer')
		).not.toHaveCount(0);
		await expect(page.getByText(/^Scale:/)).toBeVisible({ timeout: 30_000 });

		const spoken = (await page.getByText(COMPASS).textContent())!;
		const heading = Number(/Looking (\d+) degrees/.exec(spoken)![1]);
		const offset = Math.abs(heading - ACONCAGUA.camera.headingDegrees);
		expect(Math.min(offset, 360 - offset)).toBeLessThan(5);
		await expect(
			page.locator('main').getByRole('button').filter({ hasNotText: 'View photo fullscreen' })
		).toHaveText(['Zoom in', 'Zoom out', 'How to navigate', 'Reset view', 'Enter fullscreen']);
	});
});

test.describe('@webgl stage resize, fullscreen and help', () => {
	test('keeps one Viewer through help, fullscreen and a resize, and recomposes the pose', async ({
		page,
		probe
	}) => {
		await openPermalink(page);
		await tagCanvas(page);
		const before = (await cameraReading(page))!;

		await test.step('help opens as a dialog, takes focus and closes by Escape, button and trigger', async () => {
			await expect(helpPanel(page)).toBeHidden();
			await helpTrigger(page).click();
			await expect(helpPanel(page)).toBeVisible();
			await expect(helpTrigger(page)).toHaveAttribute('aria-expanded', 'true');
			await expect(helpPanel(page)).toBeFocused();
			await expect(helpPanel(page).getByRole('heading', { level: 3 })).toHaveText([
				'Mouse and trackpad',
				'Touch',
				'Buttons'
			]);
			await page.keyboard.press('Escape');
			await expect(helpPanel(page)).toBeHidden();
			await expect(helpTrigger(page)).toBeFocused();

			await helpTrigger(page).press('Enter');
			await expect(helpPanel(page)).toBeVisible();
			await page.getByRole('button', { name: 'Close navigation help' }).click();
			await expect(helpPanel(page)).toBeHidden();
			await expect(helpTrigger(page)).toBeFocused();

			await helpTrigger(page).click();
			await expect(helpPanel(page)).toBeVisible();
			await helpTrigger(page).click();
			await expect(helpPanel(page)).toBeHidden();
		});

		await test.step('help gets out of the way as soon as the globe is used', async () => {
			await helpTrigger(page).click();
			await expect(helpPanel(page)).toBeVisible();
			const canvas = await box(page.locator('canvas').first());

			await page.mouse.move(canvas.x + canvas.width * 0.75, canvas.y + canvas.height * 0.75);
			await page.mouse.down();
			await page.mouse.up();

			await expect(helpPanel(page)).toBeHidden();
			await expect(zoomIn(page)).toBeEnabled();
		});

		await test.step('fullscreen keeps the canvas and the camera, and the help stays inside it', async () => {
			await page.getByRole('button', { name: 'Enter fullscreen' }).click();

			await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
			await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('DIV');
			await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
			await expect(resetButton(page)).toBeEnabled();
			await expect
				.poll(async () => (await cameraReading(page))?.stage.width)
				.toBeGreaterThan(before.stage.width);
			const inside = (await cameraReading(page))!;
			expect(inside.stage).toEqual({ width: 1280, height: 800 });
			expect(inside.headingDegrees).toBeCloseTo(before.headingDegrees, 1);
			expect(inside.pitchDegrees).toBeCloseTo(before.pitchDegrees, 1);

			await helpTrigger(page).click();
			await expect(helpPanel(page)).toBeVisible();
			expect(
				await helpPanel(page).evaluate((panel) => document.fullscreenElement?.contains(panel))
			).toBe(true);
			const panel = await box(helpPanel(page));
			expect(panel.y + panel.height).toBeLessThanOrEqual(DESKTOP.height);
			expect(panel.x + panel.width).toBeLessThanOrEqual(DESKTOP.width);
			await helpTrigger(page).click();

			await page.getByRole('button', { name: 'Exit fullscreen' }).click();
			await expect(page.getByRole('button', { name: 'Enter fullscreen' })).toBeVisible();
			await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
			await expect
				.poll(async () => (await cameraReading(page))?.stage.width)
				.toBe(before.stage.width);
			await expectCanonicalPose(page, ACONCAGUA.camera);
		});

		await test.step('a resize recomposes the canonical pose for the new shape', async () => {
			await page.setViewportSize(SQUARE);

			await expect
				.poll(async () => (await cameraReading(page))?.stage.width)
				.not.toBe(before.stage.width);
			await expectCanonicalPose(page, ACONCAGUA.camera);
			const after = (await cameraReading(page))!;
			expect(after.displayRangeMeters).not.toBeCloseTo(before.displayRangeMeters, 0);
			expect(after.displayRangeMeters).toBeCloseTo(
				expectedDisplayRange(ACONCAGUA.camera.rangeMeters, after.stage),
				-1
			);
		});

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
		expect(await probe.webglContexts()).toBe(1);
	});
});

test.describe('@webgl stage on a phone', () => {
	test.use({ viewport: PHONE, hasTouch: true, isMobile: true });

	test('keeps every control apart and tappable, and fits the help in the stage', async ({
		page
	}) => {
		await openPermalink(page, PHONE);
		await expect(zoomIn(page)).toBeEnabled();
		const reading = (await cameraReading(page))!;
		expect(reading.displayRangeMeters).toBeCloseTo(
			expectedDisplayRange(ACONCAGUA.camera.rangeMeters, reading.stage),
			-1
		);
		const stage = await box(page.locator('[data-stage]'));
		const buttons = [
			zoomIn(page),
			page.getByRole('button', { name: 'Zoom out' }),
			helpTrigger(page),
			resetButton(page)
		];
		const boxes = await Promise.all(buttons.map(box));
		const compass = await box(page.getByText(/^Compass\./).locator('xpath=..'));

		for (const [index, current] of boxes.entries()) {
			expect(current.width).toBeGreaterThanOrEqual(44);
			expect(current.height).toBeGreaterThanOrEqual(44);
			expect(current.y + current.height).toBeLessThanOrEqual(stage.y + stage.height);
			expect(overlaps(current, compass), `button ${index} and compass`).toBe(false);
			for (const other of boxes.slice(index + 1)) {
				expect(overlaps(current, other)).toBe(false);
			}
		}

		const canonical = reading.displayRangeMeters;
		await zoomIn(page).tap();
		await expect
			.poll(async () => (await cameraReading(page))!.displayRangeMeters)
			.toBeLessThan(canonical * 0.8);

		await helpTrigger(page).tap();
		await expect(helpPanel(page)).toBeVisible();
		await expect(helpPanel(page).getByRole('heading', { level: 3 }).first()).toHaveText('Touch');
		const panel = await box(helpPanel(page));
		expect(panel.x).toBeGreaterThanOrEqual(stage.x);
		expect(panel.x + panel.width).toBeLessThanOrEqual(stage.x + stage.width);
		expect(panel.y + panel.height).toBeLessThanOrEqual(stage.y + stage.height + 1);
	});
});

test.describe('@webgl @lifecycle stage routes', () => {
	test('keeps one Viewer across client navigation, tears it down without a mountain and rebuilds it', async ({
		page,
		probe
	}) => {
		await page.setViewportSize(DESKTOP);
		await page.goto('/');
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await tagCanvas(page);

		await test.step('the daily page and its permalink share one Viewer and one pose', async () => {
			await pushRoute(page, PERMALINK);

			await expect(page).toHaveURL(new RegExp(`${PERMALINK}$`));
			await expectCanonicalPose(page, ACONCAGUA.camera);
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		});

		await test.step('another mountain re-presents on the same canvas', async () => {
			await pushRoute(page, `/mountains/${OLYMPUS.slug}`);

			await expect(page.getByRole('heading', { level: 1 })).toHaveText(OLYMPUS.name);
			await expectCanonicalPose(page, OLYMPUS.camera);
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
			await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
		});

		await test.step('a page without a mountain tears the Viewer down', async () => {
			await pushRoute(page, '/404');

			await expect.poll(() => liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });
			expect(await cameraReading(page)).toBeUndefined();
			await expect.poll(() => probe.stageObservers()).toMatchObject({ live: 0 });
			await page.setViewportSize({ width: 390, height: 844 });
			await page.setViewportSize(DESKTOP);
		});

		await test.step('coming back builds a fresh Viewer', async () => {
			await page.goBack();

			await expectReadyStage(page);
			await expectCanonicalPose(page, OLYMPUS.camera);
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
			await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(0);
			expect(await probe.webglContexts()).toBe(2);
		});
	});
});

test.describe('@webgl @lifecycle stage cancellation', () => {
	test('attaches no late viewer when the stage is torn down while the scene is still being created', async ({
		page,
		probe
	}) => {
		await page.addInitScript(() => {
			const guards: boolean[] = [];
			(window as Window & { __abortGuards?: boolean[] }).__abortGuards = guards;
			const original = AbortSignal.prototype.throwIfAborted;
			AbortSignal.prototype.throwIfAborted = function (this: AbortSignal) {
				guards.push(this.aborted);
				return original.call(this);
			};
		});
		const abortedGuards = () =>
			page.evaluate(
				() =>
					((window as Window & { __abortGuards?: boolean[] }).__abortGuards ?? []).filter(Boolean)
						.length
			);

		let terrainRequested!: () => void;
		const requested = new Promise<void>((resolve) => (terrainRequested = resolve));
		let release!: () => void;
		const held = new Promise<void>((resolve) => (release = resolve));
		await page.route('https://api.cesium.com/v1/assets/1/endpoint**', async (route) => {
			terrainRequested();
			await held;
			await route.fallback();
		});
		await page.setViewportSize(DESKTOP);
		await page.goto(PERMALINK);
		await requested;

		const abortedBeforeTeardown = await abortedGuards();
		expect(await liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });
		expect(await probe.webglContexts()).toBe(0);

		await pushRoute(page, '/404');
		await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
		release();
		await expect.poll(abortedGuards).toBeGreaterThan(abortedBeforeTeardown);

		expect(await liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });
		expect(await probe.webglContexts()).toBe(0);
		expect(await cameraReading(page)).toBeUndefined();
		await expect.poll(() => probe.stageObservers()).toMatchObject({ live: 0 });
	});
});
