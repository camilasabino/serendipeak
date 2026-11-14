import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import {
	atlasLink,
	expectGeometry,
	item,
	layer,
	openContinent,
	pauseRotation,
	servedIndex
} from './support/atlas';
import {
	ACONCAGUA,
	DESKTOP,
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

const PHONE = { width: 375, height: 740 };
const PHONE_LANDSCAPE = { width: 740, height: 375 };

// The editorial overview the atlas opens on; the camera sits a little south of it, tilted 1°.
const OVERVIEW_LATITUDE = 20;
const OVERVIEW_LONGITUDE = 10;
const LATITUDE_TOLERANCE = 1.5;
const EARTH_RADIUS_METERS = 6_371_000;
const GLOBE_FILL = 0.88;
const CESIUM_FOV_RADIANS = Math.PI / 3;

const resetView = (page: Page) => page.getByRole('button', { name: 'Reset view' });
const resumeRotation = (page: Page) => page.getByRole('button', { name: 'Rotate the globe' });

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

async function expectSameViewer(page: Page, probe: { contextsLive(): Promise<number> }) {
	expect(await canvasKept(page)).toBe(true);
	expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	expect(await probe.contextsLive()).toBe(1);
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
	test('opens on the editorial overview, turns slowly, and pauses and resumes in place', async ({
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
			expect(await probe.contextsLive()).toBe(1);
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

		await test.step('pauses and resumes in place from its control', async () => {
			await pauseRotation(page).click();
			await expect(resumeRotation(page)).toBeVisible();
			await expectStill(page);

			await resumeRotation(page).click();
			await expect(pauseRotation(page)).toBeVisible();
			await expectTurning(page);
		});
	});

	test('a drag stops the turn, and Reset returns to the overview and turns again', async ({
		page
	}) => {
		await openAtlas(page);
		await expectOverview(page);
		await expectTurning(page);

		await dragGlobe(page);
		await expect(resumeRotation(page)).toBeVisible();
		await expect.poll(async () => (await position(page)).orbiting).toBe(false);

		await resetView(page).click();
		await expectOverview(page);
		await expectTurning(page);
	});
});

test.describe('@webgl atlas overview resize', () => {
	test('a turning globe refits with no jump, and the markers follow', async ({
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
		const verdict = await expectGeometry(page, entries, true);
		expect(verdict.visibleWithinLimb).toBeGreaterThan(5);
		await expectSameViewer(page, probe);
	});

	test('a paused globe refits in place through a run of resizes, and a moved camera is left alone', async ({
		page,
		probe
	}) => {
		await openAtlas(page, PHONE);
		await expectOverview(page);
		await pauseRotation(page).click();
		await expectStill(page);
		await tagCanvas(page);
		const paused = await position(page);

		await test.step('the fit follows a run of resizes and ends on the last shape, still paused', async () => {
			for (const size of [PHONE_LANDSCAPE, DESKTOP, PHONE_LANDSCAPE]) {
				await page.setViewportSize(size);
			}

			await expectOverview(page);
			expect(await fitError(page)).toBeLessThan(0.03);
			const refitted = await position(page);
			expect(Math.abs(westwardDegrees(paused, refitted))).toBeLessThan(1e-6);
			// The camera sits a hair south of what it looks at, so a new range nudges its latitude only.
			expect(Math.abs(refitted.latitude - paused.latitude)).toBeLessThan(0.5);
			await expect(resumeRotation(page)).toBeVisible();
			await expectSameViewer(page, probe);
		});

		await test.step('a camera the reader moved stays where it is', async () => {
			await dragGlobe(page);
			await framesPass(page);
			const before = await position(page);

			await page.setViewportSize(PHONE);
			await framesPass(page);

			const after = await position(page);
			expect(after.distanceFromCenterMeters).toBeCloseTo(before.distanceFromCenterMeters, 0);
			expect(after.longitude).toBeCloseTo(before.longitude, 6);
			expect(after.latitude).toBeCloseTo(before.latitude, 6);
			expect(after.orbiting).toBe(false);
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
	test('Back during a mountain flight wins: the overview and its markers return on one Viewer', async ({
		page,
		probe,
		request
	}) => {
		const entries = await servedIndex(request);
		await openAtlas(page);
		await expectOverview(page);
		await tagCanvas(page);
		expect(await layer(page)).toMatchObject({ shown: true, layers: 1, entities: entries.length });

		await openContinent(page, 'South America');
		await item(page, ACONCAGUA.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await expect.poll(async () => (await layer(page)).shown).toBe(false);
		await page.goBack();

		await expect(page).toHaveURL(/\/atlas$/);
		await expect.poll(async () => (await layer(page)).shown).toBe(true);
		await expectOverview(page);
		await expectTurning(page);
		expect(await layer(page)).toMatchObject({ layers: 1, entities: entries.length });
		await expectSameViewer(page, probe);
	});
});

test.describe('@webgl atlas navigation interruptions', () => {
	test('a mountain chosen during the flight back to the overview wins', async ({ page, probe }) => {
		await page.setViewportSize(DESKTOP);
		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await expectReadyStage(page);
		await expectCanonicalPose(page, OLYMPUS.camera);
		await tagCanvas(page);

		await atlasLink(page).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await openContinent(page, 'South America');
		await item(page, ACONCAGUA.name).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await expectCanonicalPose(page, ACONCAGUA.camera);
		expect((await position(page)).orbiting).toBe(false);
		await expect.poll(async () => (await layer(page)).shown).toBe(false);
		await expectSameViewer(page, probe);
	});
});
