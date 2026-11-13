import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import {
	atlasLink,
	camera as atlasCamera,
	continent,
	expectGeometry,
	expectOverviewSettled,
	item,
	layer,
	openContinent,
	pauseRotation,
	servedIndex,
	visibleSlugs
} from './support/atlas';
import {
	ACONCAGUA,
	OLYMPUS,
	atlasLayer,
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

const zoomIn = (page: Page) => page.getByRole('button', { name: 'Zoom in' });
const resetView = (page: Page) => page.getByRole('button', { name: 'Reset view' });
const resumeRotation = (page: Page) => page.getByRole('button', { name: 'Rotate the globe' });
const backToAtlas = (page: Page) => page.getByRole('link', { name: /Back to atlas/ });

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

async function openAtlas(page: Page, viewport = DESKTOP) {
	await page.setViewportSize(viewport);
	await page.goto('/atlas');
	await expectReadyStage(page);
}

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@webgl atlas overview', () => {
	test('opens on the editorial overview and turns, pauses, stops for the reader and resets', async ({
		page,
		probe
	}) => {
		await openAtlas(page);

		await test.step('opens on the overview, then turns slowly at a fixed altitude', async () => {
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

		await test.step('holds still while the page is hidden and carries on when it shows again', async () => {
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

		await test.step('a drag stops the turn, and Reset returns to the overview and turns again', async () => {
			await dragGlobe(page);
			await expect(resumeRotation(page)).toBeVisible();
			await expect.poll(async () => (await position(page)).orbiting).toBe(false);

			await resetView(page).click();
			await expectOverview(page);
			await expectTurning(page);
		});

		await test.step('a zoom step stops the turn, and Reset restores the overview', async () => {
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

		await test.step('pauses and resumes in place from its control', async () => {
			await expectTurning(page);
			await pauseRotation(page).click();
			await expect(resumeRotation(page)).toBeVisible();
			await expectStill(page);
		});

		await test.step('opening and closing continents does not move the camera', async () => {
			const before = await position(page);

			await continent(page, 'Europe').click();
			await continent(page, 'South America').click();
			await continent(page, 'Europe').click();
			await framesPass(page);

			const after = await position(page);
			expect(Math.abs(westwardDegrees(before, after))).toBeLessThan(1e-6);
			expect(after.distanceFromCenterMeters).toBeCloseTo(before.distanceFromCenterMeters, 0);

			await resumeRotation(page).click();
			await expect(pauseRotation(page)).toBeVisible();
			await expectTurning(page);
		});
	});
});

test.describe('@webgl atlas overview resize', () => {
	test('refits a turning and then a paused globe in place, with markers still right', async ({
		page,
		probe,
		request
	}) => {
		await useScenario(request, 'catalog');
		const entries = await servedIndex(request);
		await openAtlas(page);
		await expectOverview(page);
		await expectTurning(page);
		await tagCanvas(page);

		await test.step('a turning globe refits with no jump and the markers follow', async () => {
			const before = await position(page);

			await page.setViewportSize(PHONE);
			await expectOverview(page);

			const after = await position(page);
			expect(after.orbiting).toBe(true);
			// Only the slow turn happened in between: same latitude, and no more than a few degrees west.
			expect(Math.abs(after.latitude - before.latitude)).toBeLessThan(0.5);
			const drift = westwardDegrees(before, after);
			expect(drift).toBeGreaterThanOrEqual(0);
			expect(drift).toBeLessThan(15);
			await expectTurning(page);
			const verdict = await expectGeometry(page, entries, true);
			expect(verdict.visibleWithinLimb).toBeGreaterThan(5);
			await expectSameViewer(page, probe);
		});

		await test.step('a paused globe refits in place, stays paused and unturned', async () => {
			await pauseRotation(page).click();
			await expectStill(page);
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
	});

	test('leaves a camera the reader moved where it is, and keeps the fit through a run of resizes', async ({
		page
	}) => {
		await openAtlas(page, PHONE);
		await expectTurning(page);

		await test.step('a moved camera stays where the reader left it', async () => {
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

		await test.step('the fit ends on the last shape after a run of resizes', async () => {
			await resetView(page).click();
			await expectOverview(page);
			await expectTurning(page);

			for (const size of [PHONE, PHONE_LANDSCAPE, DESKTOP, PHONE]) {
				await page.setViewportSize(size);
			}

			await expectOverview(page);
			expect(await fitError(page)).toBeLessThan(0.03);
			await expectTurning(page);
		});
	});

	test.describe('under reduced motion', () => {
		test.use({ reducedMotion: 'reduce' });

		test('fits a phone stage, never turns, and refits in place', async ({ page, probe }) => {
			await openAtlas(page, PHONE);

			await expectOverview(page);
			await expectStill(page);
			await expect(pauseRotation(page)).toHaveCount(0);
			await expect(resumeRotation(page)).toHaveCount(0);
			await tagCanvas(page);
			const before = await position(page);

			await page.setViewportSize(PHONE_LANDSCAPE);
			await expectOverview(page);

			const after = await position(page);
			expect(Math.abs(westwardDegrees(before, after))).toBeLessThan(1e-6);
			await expectStill(page);
			await expectSameViewer(page, probe);
		});
	});
});

test.describe('@webgl @lifecycle atlas navigation', () => {
	test('a mountain from the list, Back and Forward, and Back during the flight, on one Viewer', async ({
		page,
		probe,
		request
	}) => {
		const entries = await servedIndex(request);
		await openAtlas(page);
		await expectOverview(page);
		await tagCanvas(page);
		expect(await layer(page)).toMatchObject({ shown: true, layers: 1, entities: entries.length });

		await test.step('choosing a mountain flies there and hides the markers', async () => {
			await openContinent(page, 'South America');
			await item(page, ACONCAGUA.name).click();

			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
			await expectCanonicalPose(page, ACONCAGUA.camera);
			await expect.poll(async () => (await layer(page)).shown).toBe(false);
			expect(visibleSlugs(await layer(page))).toEqual([]);
			expect(await layer(page)).toMatchObject({ layers: 1, entities: entries.length });
		});

		await test.step('Back returns to the overview with the markers, and Forward flies again', async () => {
			await page.goBack();
			await expect(page).toHaveURL(/\/atlas$/);
			await expectOverview(page);
			await expect.poll(async () => (await layer(page)).shown).toBe(true);
			await expect(item(page, ACONCAGUA.name)).toBeVisible();
			await expectOverviewSettled(page);
			await expectGeometry(page, entries, true);

			await page.goForward();
			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
			await expectCanonicalPose(page, ACONCAGUA.camera);
		});

		await test.step('Back during a mountain flight wins: the overview and its markers return', async () => {
			await page.goBack();
			await expect(page).toHaveURL(/\/atlas$/);
			await expectOverview(page);
			await openContinent(page, 'Europe');
			await item(page, OLYMPUS.name).click();
			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expect.poll(async () => (await layer(page)).shown).toBe(false);
			await page.goBack();

			await expect(page).toHaveURL(/\/atlas$/);
			await expectOverview(page);
			await expectTurning(page);
			await expectGeometry(page, entries, true);
		});

		await expectSameViewer(page, probe);
		expect(await layer(page)).toMatchObject({ shown: true, layers: 1, entities: entries.length });
	});
});

test.describe('@webgl atlas navigation interruptions', () => {
	test('the overview, a mountain and the header link each win over a flight in progress', async ({
		page,
		probe,
		request
	}) => {
		const entries = await servedIndex(request);
		await page.setViewportSize(DESKTOP);
		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await expectReadyStage(page);
		await expectCanonicalPose(page, OLYMPUS.camera);
		await tagCanvas(page);

		await test.step('the header link returns to the overview from a mountain page', async () => {
			await atlasLink(page).click();

			await expect(page).toHaveURL(/\/atlas$/);
			await expectOverview(page);
			await expectTurning(page);
			expect(await layer(page)).toMatchObject({ shown: true, layers: 1, entities: entries.length });
			await expectSameViewer(page, probe);
		});

		await test.step('a mountain chosen during the overview flight wins', async () => {
			await openContinent(page, 'South America');
			await item(page, ACONCAGUA.name).click();
			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
			await expectCanonicalPose(page, ACONCAGUA.camera);

			await backToAtlas(page).click();
			await expect(page).toHaveURL(/\/atlas$/);
			await openContinent(page, 'Europe');
			await item(page, OLYMPUS.name).click();

			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expectCanonicalPose(page, OLYMPUS.camera);
			expect((await position(page)).orbiting).toBe(false);
		});

		await test.step('the header link during a mountain flight restores the overview and markers', async () => {
			await atlasLink(page).click();
			await expect(page).toHaveURL(/\/atlas$/);
			await openContinent(page, 'South America');
			await item(page, ACONCAGUA.name).click();
			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));

			await atlasLink(page).click();

			await expect(page).toHaveURL(/\/atlas$/);
			await expect.poll(async () => (await layer(page)).shown).toBe(true);
			await expectOverviewSettled(page);
			await expectGeometry(page, entries, true);
		});

		await test.step('a page without the stage tears the Viewer down and the atlas builds one fresh layer', async () => {
			await page
				.getByRole('navigation', { name: 'Primary' })
				.getByRole('link', { name: 'About' })
				.click();
			await expect(page).toHaveURL(/\/about$/);
			await expect.poll(() => liveViewers(page)).toEqual({ canvases: 0, viewers: 0 });
			expect(await atlasLayer(page)).toBeUndefined();

			await atlasLink(page).click();
			await expect(page).toHaveURL(/\/atlas$/);
			await expectReadyStage(page);
			expect(await layer(page)).toMatchObject({ shown: true, layers: 1, entities: entries.length });
			await expectGeometry(page, entries, true);
			expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
			expect(await atlasCamera(page)).toBeDefined();
		});
	});
});
