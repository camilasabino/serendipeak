import type { Page } from '@playwright/test';
import {
	ACONCAGUA,
	DESKTOP,
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

// Strict Mode runs effects twice only in development; production mounts once.
const STRICT_MODE = process.env.WEBGL_SERVER !== 'production';

const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const COMPASS = /^Compass\. Looking \d+ degrees \w+\.$/;

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

async function openPermalink(page: Page) {
	await page.setViewportSize(DESKTOP);
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
		expect(await probe.contextsCreated()).toBe(1);
		expect(await probe.contextsLive()).toBe(1);
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
		await expect(page.locator('[data-stage]').getByRole('button')).toHaveText([
			'Zoom in',
			'Zoom out',
			'How to navigate',
			'Reset view',
			'Enter fullscreen'
		]);
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
			expect(await probe.contextsCreated()).toBe(2);
			expect(await probe.contextsLive()).toBe(1);
		});
	});
});
