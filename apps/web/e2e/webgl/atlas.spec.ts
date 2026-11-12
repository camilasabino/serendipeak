import type { Page } from '@playwright/test';
import {
	ACONCAGUA,
	OLYMPUS,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	framesPass,
	globePosition,
	liveViewers,
	test,
	type GlobePosition
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const PHONE = { width: 375, height: 740 };
const PHONE_LANDSCAPE = { width: 740, height: 375 };

// The editorial overview the atlas opens on; the camera sits a little south of it, tilted 1°.
const OVERVIEW_LATITUDE = 20;
const OVERVIEW_LONGITUDE = 10;
const LATITUDE_TOLERANCE = 1.5;
const EARTH_RADIUS_METERS = 6_371_000;
const GLOBE_FILL = 0.88;
const CESIUM_FOV_RADIANS = Math.PI / 3;

const list = (page: Page) => page.getByRole('region', { name: 'All mountains' });
const continent = (page: Page, name: string) =>
	list(page)
		.locator('summary')
		.filter({ hasText: new RegExp(`^${name}`) });
const item = (page: Page, name: string) => list(page).getByRole('link', { name: new RegExp(name) });
const zoomIn = (page: Page) => page.getByRole('button', { name: 'Zoom in' });
const resetView = (page: Page) => page.getByRole('button', { name: 'Reset view' });
const pauseRotation = (page: Page) => page.getByRole('button', { name: 'Pause globe rotation' });
const resumeRotation = (page: Page) => page.getByRole('button', { name: 'Rotate the globe' });
const atlasLink = (page: Page) =>
	page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Atlas' });

async function position(page: Page): Promise<GlobePosition> {
	const current = await globePosition(page);
	expect(current).toBeDefined();
	return current!;
}

// The distance at which the whole globe fills the stage's narrower side, as the atlas frames it.
async function overviewDistance(page: Page): Promise<number> {
	const { width, height } = await page
		.locator('main canvas')
		.evaluate((canvas) => ({ width: canvas.clientWidth, height: canvas.clientHeight }));
	const narrow = Math.min(width, height) / Math.max(width, height);
	const halfAngle = Math.atan(Math.tan(CESIUM_FOV_RADIANS / 2) * narrow);
	return EARTH_RADIUS_METERS / (GLOBE_FILL * Math.sin(halfAngle));
}

function atOverview(current: GlobePosition | undefined, distance: number): boolean {
	return (
		current !== undefined &&
		Math.abs(current.latitude - OVERVIEW_LATITUDE) < LATITUDE_TOLERANCE &&
		Math.abs(current.distanceFromCenterMeters / distance - 1) < 0.03
	);
}

async function expectOverview(page: Page) {
	const distance = await overviewDistance(page);
	await expect
		.poll(async () => atOverview(await globePosition(page), distance), { timeout: 30_000 })
		.toBe(true);
}

async function expectTurning(page: Page) {
	await expect.poll(async () => (await position(page)).orbiting, { timeout: 30_000 }).toBe(true);
	const start = await position(page);
	// Westward drift, the surface passing beneath as the Earth turns.
	await expect
		.poll(async () => westwardDegrees(start, await position(page)), { timeout: 15_000 })
		.toBeGreaterThan(0.05);
	const later = await position(page);
	expect(later.latitude).toBeCloseTo(start.latitude, 1);
	expect(later.distanceFromCenterMeters / start.distanceFromCenterMeters).toBeCloseTo(1, 3);
}

function westwardDegrees(from: GlobePosition, to: GlobePosition): number {
	return ((((from.longitude - to.longitude) % 360) + 540) % 360) - 180;
}

async function expectStill(page: Page) {
	const before = await position(page);
	await framesPass(page);
	const after = await position(page);
	expect(after.orbiting).toBe(false);
	expect(Math.abs(westwardDegrees(before, after))).toBeLessThan(1e-6);
}

async function dragGlobe(page: Page) {
	const box = (await page.locator('main canvas').boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;
	await page.mouse.move(x, y);
	await page.mouse.down();
	await page.mouse.move(x + 120, y + 40, { steps: 8 });
	await page.mouse.up();
}

// The canvas is tagged so a later check can tell the same Viewer from a rebuilt one.
async function tagCanvas(page: Page) {
	await page.locator('main canvas').evaluate((canvas) => {
		(canvas as HTMLCanvasElement & { __kept?: boolean }).__kept = true;
	});
}

async function canvasKept(page: Page): Promise<boolean> {
	return page
		.locator('main canvas')
		.evaluate((canvas) => (canvas as HTMLCanvasElement & { __kept?: boolean }).__kept === true);
}

// How far the current distance is from the one that fits the stage as it is now.
async function fitError(page: Page): Promise<number> {
	return Math.abs(
		(await position(page)).distanceFromCenterMeters / (await overviewDistance(page)) - 1
	);
}

async function expectSameViewer(page: Page, probe: { webglContexts(): Promise<number> }) {
	expect(await canvasKept(page)).toBe(true);
	expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	expect(await probe.webglContexts()).toBe(1);
}

test.beforeEach(async ({ page }) => {
	await page.setViewportSize(DESKTOP);
});

test.describe('@webgl atlas overview', () => {
	test('opens on the editorial overview, then turns slowly at a fixed altitude', async ({
		page,
		probe
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);

		await expectOverview(page);
		const opened = await position(page);
		expect(
			Math.abs(westwardDegrees({ ...opened, longitude: OVERVIEW_LONGITUDE }, opened))
		).toBeLessThan(15);
		await expectTurning(page);
		await expect(pauseRotation(page)).toBeVisible();
		await expect(page.getByText('On the atlas')).toHaveCount(0);
		expect(await probe.webglContexts()).toBe(1);
	});

	test('fits the whole globe on a phone stage too', async ({ page }) => {
		await page.setViewportSize(PHONE);
		await page.goto('/atlas');
		await expectReadyStage(page);

		await expectOverview(page);
	});

	test('pauses and resumes in place from its control', async ({ page }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectTurning(page);

		await pauseRotation(page).click();
		await expect(resumeRotation(page)).toBeVisible();
		await expectStill(page);

		await resumeRotation(page).click();
		await expect(pauseRotation(page)).toBeVisible();
		await expectTurning(page);
	});

	test('stops for a drag, then Reset returns to the overview and turns again', async ({ page }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectTurning(page);

		await dragGlobe(page);
		await expect(resumeRotation(page)).toBeVisible();
		await expect.poll(async () => (await position(page)).orbiting).toBe(false);

		await resetView(page).click();
		await expectOverview(page);
		await expectTurning(page);
	});

	test('stops for a zoom step, and Reset restores the overview', async ({ page }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectTurning(page);
		const before = await position(page);

		await zoomIn(page).click();
		await expect
			.poll(async () => (await position(page)).distanceFromCenterMeters)
			.toBeLessThan(before.distanceFromCenterMeters * 0.95);
		expect((await position(page)).orbiting).toBe(false);

		await resetView(page).click();
		await expectOverview(page);
		await expect(pauseRotation(page)).toBeVisible();
	});

	test('never turns for a reader who prefers reduced motion', async ({ page }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.goto('/atlas');
		await expectReadyStage(page);

		await expectOverview(page);
		await expectStill(page);
		await expect(pauseRotation(page)).toHaveCount(0);
		await expect(resumeRotation(page)).toHaveCount(0);
	});

	test('holds still while the page is hidden and carries on when it shows again', async ({
		page
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectTurning(page);

		await page.evaluate(() =>
			Object.defineProperty(document, 'visibilityState', {
				configurable: true,
				get: () => 'hidden'
			})
		);
		const hidden = await position(page);
		await framesPass(page);
		const stillHidden = await position(page);
		expect(Math.abs(westwardDegrees(hidden, stillHidden))).toBeLessThan(1e-6);
		expect(stillHidden.orbiting).toBe(true);

		await page.evaluate(() => delete (document as { visibilityState?: unknown }).visibilityState);
		await expectTurning(page);
	});
});

test.describe('@webgl atlas overview resize', () => {
	for (const [name, from, to] of [
		['portrait to landscape', PHONE, PHONE_LANDSCAPE],
		['landscape to portrait', PHONE_LANDSCAPE, PHONE],
		['desktop to phone', DESKTOP, PHONE]
	] as const) {
		test(`refits a turning globe, ${name}, with no jump and the same Viewer`, async ({
			page,
			probe
		}) => {
			await page.setViewportSize(from);
			await page.goto('/atlas');
			await expectReadyStage(page);
			await expectOverview(page);
			await expectTurning(page);
			await tagCanvas(page);
			const before = await position(page);

			await page.setViewportSize(to);
			await expectOverview(page);

			const after = await position(page);
			expect(after.orbiting).toBe(true);
			// Only the slow turn happened in between: same latitude, and no more than a few degrees west.
			expect(Math.abs(after.latitude - before.latitude)).toBeLessThan(0.5);
			const drift = westwardDegrees(before, after);
			expect(drift).toBeGreaterThanOrEqual(0);
			expect(drift).toBeLessThan(15);
			await expectTurning(page);
			await expectSameViewer(page, probe);
		});
	}

	test('refits a paused globe in place, keeping it paused and unturned', async ({
		page,
		probe
	}) => {
		await page.setViewportSize(PHONE);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverview(page);
		await pauseRotation(page).click();
		await expectStill(page);
		await tagCanvas(page);
		const before = await position(page);

		await page.setViewportSize(PHONE_LANDSCAPE);
		await expectOverview(page);

		const after = await position(page);
		expect(Math.abs(westwardDegrees(before, after))).toBeLessThan(1e-6);
		// The camera sits a hair south of what it looks at, so a new range nudges its latitude only.
		expect(Math.abs(after.latitude - before.latitude)).toBeLessThan(0.5);
		await expectStill(page);
		await expect(resumeRotation(page)).toBeVisible();
		await expectSameViewer(page, probe);

		await resumeRotation(page).click();
		await expectTurning(page);
	});

	test('refits a still globe for a reader who prefers reduced motion', async ({ page, probe }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await page.setViewportSize(PHONE);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectOverview(page);
		await tagCanvas(page);
		const before = await position(page);

		await page.setViewportSize(PHONE_LANDSCAPE);
		await expectOverview(page);

		const after = await position(page);
		expect(Math.abs(westwardDegrees(before, after))).toBeLessThan(1e-6);
		await expectStill(page);
		await expectSameViewer(page, probe);
	});

	test('leaves a camera the reader moved where it is', async ({ page }) => {
		await page.setViewportSize(PHONE);
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectTurning(page);
		await dragGlobe(page);
		await expect(resumeRotation(page)).toBeVisible();
		await framesPass(page);
		const before = await position(page);

		await page.setViewportSize(PHONE_LANDSCAPE);
		await framesPass(page);

		const after = await position(page);
		expect(after.distanceFromCenterMeters).toBeCloseTo(before.distanceFromCenterMeters, 0);
		expect(after.longitude).toBeCloseTo(before.longitude, 6);
		expect(after.latitude).toBeCloseTo(before.latitude, 6);
		expect(after.orbiting).toBe(false);
		await expect(resumeRotation(page)).toBeVisible();
	});

	test('keeps the fit through a run of resizes, ending on the last shape', async ({ page }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await expectTurning(page);

		for (const size of [PHONE, PHONE_LANDSCAPE, DESKTOP, PHONE]) {
			await page.setViewportSize(size);
		}

		await expectOverview(page);
		expect(await fitError(page)).toBeLessThan(0.03);
		await expectTurning(page);
	});
});

test.describe('@webgl atlas navigation', () => {
	test('returns to the overview from a mountain page, with one Viewer throughout', async ({
		page,
		probe
	}) => {
		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await expectReadyStage(page);
		await expectCanonicalPose(page, OLYMPUS.camera);

		await atlasLink(page).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await expectOverview(page);
		await expectTurning(page);

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});

	test('flies to a mountain chosen in the list, and Back and Forward follow', async ({
		page,
		probe
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);

		await continent(page, 'South America').click();
		await item(page, ACONCAGUA.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		await expectCanonicalPose(page, ACONCAGUA.camera);

		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await expectOverview(page);
		await expect(item(page, ACONCAGUA.name)).toBeVisible();

		await page.goForward();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await expectCanonicalPose(page, ACONCAGUA.camera);

		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
		expect(await probe.webglContexts()).toBe(1);
	});

	test('steps back through Back to atlas: the overview again, one Viewer, no second atlas entry', async ({
		page,
		probe
	}) => {
		await page.goto('/');
		await expectReadyStage(page);
		await atlasLink(page).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await expectOverview(page);
		await tagCanvas(page);

		await continent(page, 'Europe').click();
		await item(page, OLYMPUS.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expectCanonicalPose(page, OLYMPUS.camera);

		await page.getByRole('link', { name: /Back to atlas/ }).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await expectOverview(page);
		await expectTurning(page);
		await expectSameViewer(page, probe);

		await page.goBack();
		await expect(page).toHaveURL(/\/$/);
		await expectSameViewer(page, probe);
	});

	test('lets Back during a mountain flight win: it ends on the overview', async ({ page }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);

		await continent(page, 'Europe').click();
		await item(page, OLYMPUS.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await page.goBack();

		await expect(page).toHaveURL(/\/atlas$/);
		await expectOverview(page);
		await expectTurning(page);
	});

	test('lets a mountain chosen during the overview flight win', async ({ page }) => {
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await expectReadyStage(page);
		await expectCanonicalPose(page, ACONCAGUA.camera);

		await page.getByRole('link', { name: /Back to atlas/ }).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await continent(page, 'Europe').click();
		await item(page, OLYMPUS.name).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expectCanonicalPose(page, OLYMPUS.camera);
		expect((await position(page)).orbiting).toBe(false);
	});

	test('returns through the Back to atlas link from a page opened directly', async ({ page }) => {
		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await expectReadyStage(page);
		await expectCanonicalPose(page, OLYMPUS.camera);

		await page.getByRole('link', { name: /Back to atlas/ }).click();

		await expect(page).toHaveURL(/\/atlas$/);
		await expectOverview(page);
		await expect(pauseRotation(page)).toBeVisible();
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});

	test('keeps the camera where it is while continents open and close', async ({ page }) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await pauseRotation(page).click();
		const before = await position(page);

		await continent(page, 'Europe').click();
		await continent(page, 'South America').click();
		await continent(page, 'Europe').click();
		await framesPass(page);

		const after = await position(page);
		expect(Math.abs(westwardDegrees(before, after))).toBeLessThan(1e-6);
		expect(after.distanceFromCenterMeters).toBeCloseTo(before.distanceFromCenterMeters, 0);
	});
});
