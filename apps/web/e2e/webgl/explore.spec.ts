import type { Page } from '@playwright/test';
import { fixture } from '../ssr/support';
import {
	ACONCAGUA,
	BARE_PEAK,
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

// Answers the destination choice with `record` only once the test releases it.
async function holdRandom(page: Page, record: unknown = OLYMPUS_RECORD) {
	let release!: () => void;
	const released = new Promise<void>((resolve) => (release = resolve));
	const requested: string[] = [];
	await page.route(RANDOM_ENDPOINT, async (route) => {
		requested.push(new URL(route.request().url()).search);
		await released;
		await route.fulfill({
			json: record,
			headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
		});
	});

	return { release, requested };
}

// Records every route change the router starts, so a stale push is visible without waiting for it.
async function recordRoutes(page: Page) {
	await page.evaluate(() => {
		const win = window as Window & {
			__routes?: string[];
			next?: { router: { events: { on(event: string, handler: (url: string) => void): void } } };
		};
		win.__routes = [];
		win.next!.router.events.on('routeChangeStart', (url) => win.__routes!.push(url));
	});
}

const routesStarted = (page: Page) =>
	page.evaluate(() => (window as Window & { __routes?: string[] }).__routes ?? []);

// Releases a held answer and waits until the page has consumed it, with no sleep: the response is
// observed, then two frames let any promise continuation it started run.
async function releaseAndConsume(page: Page, release: () => void) {
	const answered = page.waitForResponse((response) => response.url().includes('/mountains/random'));
	release();
	await answered;
	await page.evaluate(
		() =>
			new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			)
	);
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

async function expectIdleAt(page: Page, mountain: typeof OLYMPUS | typeof BARE_PEAK) {
	await expect(page).toHaveURL(new RegExp(`/mountains/${mountain.slug}$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(mountain.name);
	if ('camera' in mountain) {
		await expectCanonicalPose(page, mountain.camera);
	}
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

test.describe('@webgl Explore superseded before the scene owns the destination', () => {
	test('a permalink pushed while the destination is being chosen wins over the late answer', async ({
		page,
		probe
	}) => {
		const random = await holdRandom(page);
		await openStage(page, `/mountains/${BARE_PEAK.slug}`);
		await recordRoutes(page);

		await exploreButton(page).click();
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await pushRoute(page, PERMALINK);
		await expectIdleAt(page, ACONCAGUA);
		await releaseAndConsume(page, random.release);

		await expectIdleAt(page, ACONCAGUA);
		expect(await routesStarted(page)).toEqual([PERMALINK]);
		await expectPersistentViewer(page, probe);
		expect(random.requested).toEqual([`?exclude=${BARE_PEAK.slug}`]);
	});

	test('browser Back while the destination is being chosen wins and Explore stays usable', async ({
		page,
		probe
	}) => {
		const random = await holdRandom(page);
		await openStage(page);
		await pushRoute(page, `/mountains/${BARE_PEAK.slug}`);
		await expectIdleAt(page, BARE_PEAK);
		await recordRoutes(page);

		await exploreButton(page).click();
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await page.goBack();
		await expectIdleAt(page, ACONCAGUA);
		await releaseAndConsume(page, random.release);

		await expectIdleAt(page, ACONCAGUA);
		expect(await routesStarted(page)).toEqual([PERMALINK]);
		await expectPersistentViewer(page, probe);

		await exploreButton(page).click();
		await expectIdleAt(page, OLYMPUS);
		await expectPersistentViewer(page, probe);
	});

	test('browser Back while the scene is travelling wins and the abandoned flight never lands', async ({
		page,
		probe
	}) => {
		await chooseOlympus(page);
		await openStage(page);
		await recordRoutes(page);

		await exploreButton(page).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await page.goBack();

		await expectIdleAt(page, ACONCAGUA);
		expect(await routesStarted(page)).toEqual([`/mountains/${OLYMPUS.slug}`, PERMALINK]);
		await expectPersistentViewer(page, probe);
	});

	test('a destination photograph that is still loading neither delays nor blocks the travel', async ({
		page,
		probe
	}) => {
		await chooseOlympus(page);
		await openStage(page);
		let release!: () => void;
		const released = new Promise<void>((resolve) => (release = resolve));
		const photos: string[] = [];
		await page.route(/^https:\/\/(upload|thumb)\.wikimedia\.org\//, async (route) => {
			photos.push(route.request().url());
			await released;
			await route.fulfill({
				contentType: 'image/svg+xml',
				body: '<svg xmlns="http://www.w3.org/2000/svg"/>'
			});
		});

		await exploreButton(page).click();

		await expectIdleAt(page, OLYMPUS);
		await expectPersistentViewer(page, probe);
		expect(photos.length).toBeGreaterThan(0);
		release();
	});
});

test.describe('@webgl Same destination', () => {
	test('exploring to the mountain already shown settles at once on the same viewer', async ({
		page,
		probe
	}) => {
		await page.route(RANDOM_ENDPOINT, (route) =>
			route.fulfill({
				json: fixture<unknown>('mountain-complete.json'),
				headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
			})
		);
		await openStage(page);

		await exploreButton(page).click();

		await expectIdleAt(page, ACONCAGUA);
		await expectPersistentViewer(page, probe);
	});

	test('the daily page and its permalink share one viewer and one pose', async ({
		page,
		probe
	}) => {
		await openStage(page, '/');
		await recordRoutes(page);

		await pushRoute(page, PERMALINK);

		await expectIdleAt(page, ACONCAGUA);
		expect(await routesStarted(page)).toEqual([PERMALINK]);
		await expectPersistentViewer(page, probe);
	});
});
