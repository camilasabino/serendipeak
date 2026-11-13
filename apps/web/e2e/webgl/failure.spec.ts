import {
	ACONCAGUA,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	liveViewers,
	test
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const TERRAIN_ENDPOINT = 'https://api.cesium.com/v1/assets/1/endpoint**';

test.describe('@webgl @lifecycle stage failure and retry', () => {
	test('recovers to the canonical pose with exactly one viewer after Try again', async ({
		page,
		probe
	}) => {
		probe.tolerate({
			requests: /api\.cesium\.com\/v1\/assets\/1\/endpoint/,
			errors: /Cesium viewer failed to initialize|Failed to load resource/
		});
		let available = false;
		let attempts = 0;
		await page.route(TERRAIN_ENDPOINT, async (route) => {
			attempts += 1;
			if (!available) {
				await route.fulfill({ status: 500, body: 'unavailable' });
				return;
			}
			await route.fallback();
		});
		await page.setViewportSize(DESKTOP);

		await page.goto(PERMALINK);

		const alert = page.locator('main [role="alert"]');
		const retry = page.getByRole('button', { name: 'Try again' });
		await expect(alert).toContainText('The 3D globe could not be loaded.');
		await expect(alert).toContainText('The mountain details are still available.');
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		await expect(page.getByRole('button', { name: 'Reset view' })).toHaveCount(0);
		expect(await liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });
		expect(await probe.webglContexts()).toBe(0);
		const attemptsBeforeRetry = attempts;
		const observedBeforeRetry = (await probe.stageObservers()).observed;

		await retry.click();
		await expect.poll(() => attempts).toBeGreaterThan(attemptsBeforeRetry);
		await expect(alert).toContainText('The 3D globe could not be loaded.');
		await expect(retry).toBeVisible();
		expect(await liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });

		await expect(retry).toBeFocused();

		available = true;
		await page.keyboard.press('Enter');

		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
		expect(await probe.stageObservers()).toEqual({ observed: observedBeforeRetry, live: 1 });
		await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Reset view' })).toBeEnabled();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		await expect(page.locator('[data-stage]')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.locator('[data-stage]')).not.toBeFocused();
	});
});
