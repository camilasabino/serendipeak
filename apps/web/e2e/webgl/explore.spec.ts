import type { Page } from '@playwright/test';
import { fixture } from '../ssr/support';
import {
	ACONCAGUA,
	OLYMPUS,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	liveViewers,
	test
} from './support/stage';

const DESKTOP = { width: 1280, height: 800 };
const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const RANDOM_ENDPOINT = '**/api/v1/mountains/random**';
const OLYMPUS_RECORD = fixture<unknown>('mountain-sparse.json');
const LONGEST_TRAVEL_MS = 3_000;

const exploreButton = (page: Page) =>
	page.getByRole('button', { name: /^Explore another|^Exploring/ });
const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset view' });

// The API stays the real stub; only the choice of destination is made deterministic.
async function chooseOlympus(page: Page): Promise<string[]> {
	const requested: string[] = [];
	await page.route(RANDOM_ENDPOINT, (route) => {
		requested.push(new URL(route.request().url()).search);
		return route.fulfill({
			json: OLYMPUS_RECORD,
			headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
		});
	});

	return requested;
}

async function pushRoute(page: Page, url: string) {
	await page.evaluate((target) => {
		void (
			window as Window & { next?: { router: { push(url: string): Promise<boolean> } } }
		).next!.router.push(target);
	}, url);
}

async function openStage(page: Page, url = PERMALINK) {
	await page.setViewportSize(DESKTOP);
	await page.goto(url);
	await expectReadyStage(page);
	await expect(resetButton(page)).toBeEnabled();
	await page.evaluate(() => document.querySelector('canvas')?.setAttribute('data-probe', 'first'));
}

async function expectIdleAt(page: Page, mountain: typeof OLYMPUS) {
	await expect(page).toHaveURL(new RegExp(`/mountains/${mountain.slug}$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(mountain.name);
	await expectCanonicalPose(page, mountain.camera);
	await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'false');
	await expect(resetButton(page)).toBeEnabled();
}

async function expectPersistentViewer(page: Page, probe: { webglContexts(): Promise<number> }) {
	expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
	expect(await probe.webglContexts()).toBe(1);
}

test.describe('@webgl Explore', () => {
	test('travels to the destination, settles on its canonical pose and keeps the same viewer', async ({
		page,
		probe
	}) => {
		const requested = await chooseOlympus(page);
		await openStage(page);

		await exploreButton(page).click();
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');

		await expectIdleAt(page, OLYMPUS);
		await expectPersistentViewer(page, probe);
		expect(requested).toEqual([`?exclude=${ACONCAGUA.slug}`]);
	});

	test('explores again from the destination it arrived at', async ({ page, probe }) => {
		const requested = await chooseOlympus(page);
		await openStage(page);
		await exploreButton(page).click();
		await expectIdleAt(page, OLYMPUS);

		await pushRoute(page, PERMALINK);
		await expectIdleAt(page, ACONCAGUA);
		await exploreButton(page).click();

		await expectIdleAt(page, OLYMPUS);
		await expectPersistentViewer(page, probe);
		expect(requested).toEqual([`?exclude=${ACONCAGUA.slug}`, `?exclude=${ACONCAGUA.slug}`]);
	});

	test('ignores repeated clicks while the scene is travelling', async ({ page, probe }) => {
		const requested = await chooseOlympus(page);
		await openStage(page);

		await exploreButton(page).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await exploreButton(page).click({ force: true });
		await exploreButton(page).click({ force: true });

		await expectIdleAt(page, OLYMPUS);
		await expectPersistentViewer(page, probe);
		expect(requested).toHaveLength(1);
	});

	test('lets a newer navigation win mid-travel and leaves no stale destination in charge', async ({
		page,
		probe
	}) => {
		const requested = await chooseOlympus(page);
		await openStage(page);

		await exploreButton(page).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await pushRoute(page, PERMALINK);

		await expectIdleAt(page, ACONCAGUA);
		// Negative evidence: the abandoned flight has had longer than any flight lasts to finish.
		await page.waitForTimeout(LONGEST_TRAVEL_MS);
		await expectIdleAt(page, ACONCAGUA);
		await expectPersistentViewer(page, probe);

		await exploreButton(page).click();
		await expectIdleAt(page, OLYMPUS);
		await expectPersistentViewer(page, probe);
		expect(requested).toHaveLength(2);
	});

	test('reaches the same destination state with reduced motion', async ({ page, probe }) => {
		await page.emulateMedia({ reducedMotion: 'reduce' });
		const requested = await chooseOlympus(page);
		await openStage(page);

		await exploreButton(page).click();

		await expectIdleAt(page, OLYMPUS);
		await expectPersistentViewer(page, probe);
		expect(requested).toHaveLength(1);
	});

	test('explores from the daily page without changing what / serves', async ({ page, probe }) => {
		await chooseOlympus(page);
		await openStage(page, '/');

		await exploreButton(page).click();
		await expectIdleAt(page, OLYMPUS);
		await expectPersistentViewer(page, probe);

		await page.goto('/');
		await expectReadyStage(page);
		await expect(page).toHaveURL(/\/$/);
		await expectCanonicalPose(page, ACONCAGUA.camera);
	});
});
