import type { Locator, Page } from '@playwright/test';
import {
	ACONCAGUA,
	DESKTOP,
	IMAGERY_HOST,
	TERRAIN_HOST,
	cameraReading,
	expect,
	expectCanonicalPose,
	liveViewers,
	test
} from './support/stage';

const PHONE = { width: 390, height: 844 };
const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const IMAGERY_ENDPOINT = 'https://api.cesium.com/v1/assets/3954/endpoint**';
const DEGRADED = 'Map imagery is temporarily unavailable.';
const DEGRADED_WARNING = 'Base imagery degraded; the scene continues without it.';

interface Traffic {
	imagery: string[];
	terrain: string[];
	warnings: string[];
}

function observe(page: Page): Traffic {
	const traffic: Traffic = { imagery: [], terrain: [], warnings: [] };
	page.on('request', (request) => {
		if (request.url().startsWith(IMAGERY_HOST)) traffic.imagery.push(request.url());
		if (request.url().startsWith(TERRAIN_HOST)) traffic.terrain.push(request.url());
	});
	page.on('console', (message) => {
		if (message.type() === 'warning') traffic.warnings.push(message.text());
	});
	return traffic;
}

async function expectDegradedButUsable(page: Page, traffic: Traffic) {
	const notice = page.locator('main [role="status"]', { hasText: DEGRADED });
	await expect(notice).toBeVisible({ timeout: 60_000 });
	await expect(notice).toContainText('The mountain details are still available.');
	await expect(page.locator('main [role="alert"]')).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);

	await expect(page.getByRole('button', { name: 'Reset view' })).toBeEnabled();
	await expectCanonicalPose(page, ACONCAGUA.camera);
	expect(traffic.terrain.length, 'terrain tiles requested').toBeGreaterThan(0);
	expect(traffic.warnings).toContain(DEGRADED_WARNING);
}

interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

function visibleBoxes(locator: Locator): Promise<Box[]> {
	return locator.evaluateAll((elements) =>
		elements.flatMap((element) => {
			const rect = element.getBoundingClientRect();
			const style = getComputedStyle(element);
			const shown = rect.width > 0 && rect.height > 0 && style.visibility === 'visible';
			return shown
				? [{ left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom }]
				: [];
		})
	);
}

function overlaps(a: Box, b: Box): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

// Cesium's data attribution is a licence obligation, so the notice must never cover it.
async function expectNoticeClearOfAttribution(page: Page, notice: Locator) {
	const [noticeBox] = await visibleBoxes(notice);
	const credits = await visibleBoxes(
		page.locator(
			'.cesium-widget-credits, .cesium-credit-logoContainer, .cesium-credit-textContainer'
		)
	);
	expect(noticeBox, 'the notice is laid out').toBeDefined();
	expect(credits.length, 'Cesium attribution is visible').toBeGreaterThan(0);
	for (const credit of credits) {
		expect(
			overlaps(noticeBox!, credit),
			`notice ${JSON.stringify(noticeBox)} vs credit ${JSON.stringify(credit)}`
		).toBe(false);
	}
	const controls = await visibleBoxes(page.locator('main button'));
	const text = await visibleBoxes(notice.locator('p'));
	for (const line of text) {
		for (const control of controls) {
			expect(
				overlaps(line, control),
				`notice text ${JSON.stringify(line)} vs control ${JSON.stringify(control)}`
			).toBe(false);
		}
	}
}

async function expectSingleViewer(page: Page, probe: { contextsLive(): Promise<number> }) {
	expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	expect(await probe.contextsLive()).toBe(1);
}

test.describe('@webgl stage imagery degradation', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize(DESKTOP);
	});

	test('keeps the same viewer and publishes a status notice when imagery tiles fail at runtime', async ({
		page,
		probe
	}) => {
		probe.tolerate({
			requests: /imagery\.e2e\.invalid.*\(403\)/,
			errors: /Failed to load resource: the server responded with a status of 403/
		});
		const traffic = observe(page);
		await page.route(`${IMAGERY_HOST}**`, (route) =>
			route.fulfill({ status: 403, body: 'forbidden' })
		);

		await page.goto(PERMALINK);
		await page.waitForSelector('canvas');
		await page.evaluate(() =>
			document.querySelector('canvas')?.setAttribute('data-probe', 'first')
		);

		await expectDegradedButUsable(page, traffic);
		expect(
			traffic.imagery.length,
			'imagery tiles were requested before they failed'
		).toBeGreaterThan(0);
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
		await expectSingleViewer(page, probe);
		expect((await probe.stageObservers()).live).toBe(1);
		expect(await cameraReading(page)).toBeDefined();

		const notice = page.locator('main [role="status"]', { hasText: DEGRADED });
		await expectNoticeClearOfAttribution(page, notice);
		await page.setViewportSize(PHONE);
		await expect(notice).toBeVisible();
		await expectNoticeClearOfAttribution(page, notice);
	});

	test('drops the base layer and keeps terrain when the imagery provider cannot be created', async ({
		page,
		probe
	}) => {
		probe.tolerate({
			requests: /api\.cesium\.com\/v1\/assets\/3954\/endpoint/,
			errors: /Failed to load resource: the server responded with a status of 500/
		});
		const traffic = observe(page);
		await page.route(IMAGERY_ENDPOINT, (route) =>
			route.fulfill({ status: 500, body: 'unavailable' })
		);

		await page.goto(PERMALINK);
		await page.waitForSelector('canvas');
		await page.evaluate(() =>
			document.querySelector('canvas')?.setAttribute('data-probe', 'first')
		);

		await expectDegradedButUsable(page, traffic);
		expect(traffic.imagery, 'no imagery tile can be requested without a provider').toEqual([]);
		await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
		await expectSingleViewer(page, probe);
		expect((await probe.stageObservers()).live).toBe(1);
	});
});
