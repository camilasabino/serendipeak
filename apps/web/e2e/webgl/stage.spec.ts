import {
	ACONCAGUA,
	OLYMPUS,
	cameraReading,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	expectedDisplayRange,
	liveViewers,
	test
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 390, height: 844 };
const SQUARE = { width: 1000, height: 1000 };

// Strict Mode runs effects twice only in development; production mounts once.
const STRICT_MODE = process.env.WEBGL_SERVER !== 'production';

const PERMALINK = `/mountains/${ACONCAGUA.slug}`;

test.describe('@webgl static stage', () => {
	for (const [name, viewport] of [
		['desktop', DESKTOP],
		['phone', PHONE]
	] as const) {
		test(`reaches the canonical pose of a permalink on a ${name} stage`, async ({
			page,
			probe
		}) => {
			await page.setViewportSize(viewport);
			await page.goto(PERMALINK);
			await expectReadyStage(page);

			await expectCanonicalPose(page, ACONCAGUA.camera);
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
		});
	}

	test('reaches the canonical pose of the daily mountain on /', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await page.goto('/');
		await expectReadyStage(page);

		await expectCanonicalPose(page, ACONCAGUA.camera);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});

	test('follows the container size and recomposes the canonical pose', async ({ page }) => {
		await page.setViewportSize(DESKTOP);
		await page.goto(PERMALINK);
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		const before = (await cameraReading(page))!;

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
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});

	test('keeps one viewer across client navigation and re-presents the new mountain', async ({
		page
	}) => {
		await page.setViewportSize(DESKTOP);
		await page.goto(PERMALINK);
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await page.evaluate(() =>
			document.querySelector('canvas')?.setAttribute('data-probe', 'first')
		);

		await page.evaluate((slug) => {
			void (
				window as Window & { next?: { router: { push(url: string): Promise<boolean> } } }
			).next!.router.push(`/mountains/${slug}`);
		}, OLYMPUS.slug);

		await expect(page.getByRole('heading', { level: 1 })).toHaveText(OLYMPUS.name);
		await expectCanonicalPose(page, OLYMPUS.camera);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
	});

	test('tears the viewer down when the page has no mountain and builds a fresh one on return', async ({
		page,
		probe
	}) => {
		await page.setViewportSize(DESKTOP);
		await page.goto(PERMALINK);
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		await page.evaluate(() =>
			document.querySelector('canvas')?.setAttribute('data-probe', 'first')
		);

		await page.evaluate(() => {
			void (
				window as Window & { next?: { router: { push(url: string): Promise<boolean> } } }
			).next!.router.push('/404');
		});

		await expect.poll(() => liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });
		expect(await cameraReading(page)).toBeUndefined();
		await expect.poll(() => probe.stageObservers()).toMatchObject({ live: 0 });
		await page.setViewportSize(PHONE);
		await page.setViewportSize(DESKTOP);

		await page.goBack();
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(0);
		expect(await probe.webglContexts()).toBe(2);
	});

	test('attaches no late viewer when the stage is torn down while the scene is still being created', async ({
		page,
		probe
	}) => {
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

		await page.evaluate(() => {
			void (
				window as Window & { next?: { router: { push(url: string): Promise<boolean> } } }
			).next!.router.push('/404');
		});
		await expect(page.getByRole('heading', { name: 'Page not found' })).toBeVisible();
		const layerRequested = page.waitForRequest(/terrain\.e2e\.invalid\/layer\.json/);
		release();
		await layerRequested;
		await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));

		expect(await liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });
		expect(await probe.webglContexts()).toBe(0);
		expect(await cameraReading(page)).toBeUndefined();
		await expect.poll(() => probe.stageObservers()).toMatchObject({ live: 0 });
	});
});
