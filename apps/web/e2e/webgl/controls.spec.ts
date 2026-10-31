import type { Page } from '@playwright/test';
import {
	ACONCAGUA,
	cameraReading,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	liveViewers,
	poseDifference,
	test
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const COMPASS = /^Compass\. Looking \d+ degrees \w+\.$/;

const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset view' });

// Ctrl+drag rotates the view; a plain drag only pans, which leaves the heading alone.
async function rotateCamera(page: Page) {
	const box = (await page.locator('canvas').first().boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;

	await page.keyboard.down('Control');
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 220, y + 40, { steps: 12 });
	await page.mouse.up();
	await page.keyboard.up('Control');
}

async function expectArrived(page: Page) {
	await expectReadyStage(page);
	await expect(resetButton(page)).toBeEnabled();
	await expectCanonicalPose(page, ACONCAGUA.camera);
}

async function expectMovedAway(page: Page) {
	await expect
		.poll(async () => {
			const reading = await cameraReading(page);
			return reading ? poseDifference(reading, ACONCAGUA.camera) : undefined;
		})
		.toBeDefined();
}

async function tagCanvas(page: Page) {
	await page.evaluate(() => document.querySelector('canvas')?.setAttribute('data-probe', 'first'));
}

test.describe('@webgl stage controls', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(DESKTOP);
	});

	test('replaces the Cesium default controls with the stage controls', async ({ page }) => {
		await page.goto(PERMALINK);
		await expectArrived(page);

		await expect(page.locator('.cesium-viewer')).toHaveCount(1);
		await expect(page.locator('.cesium-viewer-toolbar button, .cesium-button')).toHaveCount(0);
		await expect(
			page.locator('.cesium-navigation-help-button, .cesium-navigation-help')
		).toHaveCount(0);
		await expect(page.locator('.cesium-viewer-fullscreenContainer')).toHaveCount(0);
		await expect(
			page.locator('.cesium-credit-lightbox-overlay, .cesium-credit-logoContainer')
		).not.toHaveCount(0);

		await expect(resetButton(page)).toBeEnabled();
		await expect(page.getByText(COMPASS)).toHaveCount(1);
		await expect(page.getByText(/^Scale:/)).toBeVisible({ timeout: 30_000 });
	});

	test('shows the canonical heading and keeps the compass read-only', async ({ page }) => {
		await page.goto(PERMALINK);
		await expectArrived(page);

		const compass = page.getByText(COMPASS);
		const spoken = (await compass.textContent())!;
		const heading = Number(/Looking (\d+) degrees/.exec(spoken)![1]);
		// The camera looks along the canonical heading, offset a little by the stage framing.
		const offset = Math.abs(heading - ACONCAGUA.camera.headingDegrees);
		expect(Math.min(offset, 360 - offset)).toBeLessThan(5);
		await expect(page.locator('main').getByRole('button')).toHaveText([
			'Reset view',
			'Enter fullscreen'
		]);
	});

	test('Reset returns a moved camera to the canonical pose in the same viewer', async ({
		page,
		probe
	}) => {
		await page.goto(PERMALINK);
		await expectArrived(page);
		await tagCanvas(page);
		const canonicalHeading = await page.getByText(COMPASS).textContent();

		await rotateCamera(page);

		await expectMovedAway(page);
		await expect(page.getByText(COMPASS)).not.toHaveText(canonicalHeading!);
		await expect(resetButton(page)).toBeEnabled();

		await resetButton(page).click();

		await expectCanonicalPose(page, ACONCAGUA.camera);
		await expect(page.getByText(COMPASS)).toHaveText(canonicalHeading!);
		await expect(resetButton(page)).toBeEnabled();
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
		expect(await probe.webglContexts()).toBe(1);
	});

	test('Reset is a no-op at the canonical pose', async ({ page }) => {
		await page.goto(PERMALINK);
		await expectArrived(page);
		const before = await cameraReading(page);

		await resetButton(page).click();
		await resetButton(page).click();

		await expect(resetButton(page)).toBeEnabled();
		await expectCanonicalPose(page, ACONCAGUA.camera);
		expect(await cameraReading(page)).toEqual(before);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});

	test('Reset is keyboard operable and reaches the same pose under reduced motion', async ({
		page
	}) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto(PERMALINK);
		await expectArrived(page);
		await rotateCamera(page);
		await expectMovedAway(page);

		await resetButton(page).focus();
		await page.keyboard.press('Enter');

		await expectCanonicalPose(page, ACONCAGUA.camera);
		await expect(resetButton(page)).toBeFocused();
	});

	test('fullscreen keeps the viewer, the canvas and the camera while the stage resizes', async ({
		page,
		probe
	}) => {
		await page.goto(PERMALINK);
		await expectArrived(page);
		await tagCanvas(page);
		const before = (await cameraReading(page))!;
		const enter = page.getByRole('button', { name: 'Enter fullscreen' });

		await enter.click();

		await expect(page.getByRole('button', { name: 'Exit fullscreen' })).toBeVisible();
		await expect.poll(() => page.evaluate(() => document.fullscreenElement?.tagName)).toBe('DIV');
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		await expect(resetButton(page)).toBeEnabled();
		await expect
			.poll(async () => (await cameraReading(page))?.stage.width)
			.toBeGreaterThan(before.stage.width);
		const inside = (await cameraReading(page))!;
		expect(inside.stage).toEqual({ width: 1280, height: 800 });
		expect(inside.headingDegrees).toBeCloseTo(before.headingDegrees, 1);
		expect(inside.pitchDegrees).toBeCloseTo(before.pitchDegrees, 1);
		expect((await page.locator('canvas').first().boundingBox())!.width).toBe(1280);

		await page.getByRole('button', { name: 'Exit fullscreen' }).click();

		await expect(enter).toBeVisible();
		await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBeNull();
		await expect
			.poll(async () => (await cameraReading(page))?.stage.width)
			.toBe(before.stage.width);
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
		await expectCanonicalPose(page, ACONCAGUA.camera);
	});
});
