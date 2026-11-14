import type { Page } from '@playwright/test';
import { fixture } from '../ssr/support';
import {
	ACONCAGUA,
	DESKTOP,
	OLYMPUS,
	cameraReading,
	expect,
	expectCanonicalPose,
	expectReadyStage,
	framesPass,
	liveViewers,
	test
} from './support/stage';

const PERMALINK = `/mountains/${ACONCAGUA.slug}`;
const RANDOM_ENDPOINT = '**/api/v1/mountains/random**';
const LONGEST_TRAVEL_MS = 3_000;

const exploreButton = (page: Page) =>
	page.getByRole('button', { name: /^Explore another|^Exploring/ });
const resetButton = (page: Page) => page.getByRole('button', { name: 'Reset view' });

// The API stays the real stub; only the choice of destination is made deterministic: the other of
// the two mountains the suite knows, so each Explore is one flight and none has to return first.
async function chooseOtherDestination(page: Page): Promise<string[]> {
	const requested: string[] = [];
	await page.route(RANDOM_ENDPOINT, (route) => {
		const search = new URL(route.request().url()).search;
		requested.push(search);
		const toOlympus = search === `?exclude=${ACONCAGUA.slug}`;

		return route.fulfill({
			json: fixture<unknown>(toOlympus ? 'mountain-sparse.json' : 'mountain-complete.json'),
			headers: { 'access-control-allow-origin': '*', 'cache-control': 'no-store' }
		});
	});

	return requested;
}

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

async function pushRoute(page: Page, url: string) {
	await page.evaluate((target) => {
		void (
			window as Window & { next?: { router: { push(url: string): Promise<boolean> } } }
		).next!.router.push(target);
	}, url);
}

// Negative evidence needs elapsed time, but only time the page spent rendering counts: an
// abandoned flight can only land on frames the page actually draws.
async function renderedFor(page: Page, milliseconds: number) {
	await page.evaluate(
		(duration) =>
			new Promise<void>((resolve) => {
				const start = performance.now();
				const next = () =>
					performance.now() - start >= duration ? resolve() : requestAnimationFrame(next);
				requestAnimationFrame(next);
			}),
		milliseconds
	);
}

async function openStage(page: Page, url = PERMALINK) {
	await page.setViewportSize(DESKTOP);
	await page.goto(url);
	await expectReadyStage(page);
	await expect(resetButton(page)).toBeEnabled();
	await page.evaluate(() => document.querySelector('canvas')?.setAttribute('data-probe', 'first'));
}

async function expectIdleAt(page: Page, mountain: typeof OLYMPUS | typeof ACONCAGUA) {
	await expect(page).toHaveURL(new RegExp(`/mountains/${mountain.slug}$`));
	await expect(page.getByRole('heading', { level: 1 })).toHaveText(mountain.name);
	await expectCanonicalPose(page, mountain.camera);
	await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'false');
	await expect(resetButton(page)).toBeEnabled();
}

async function expectPersistentViewer(page: Page, probe: { contextsLive(): Promise<number> }) {
	expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	await expect(page.locator('canvas[data-probe="first"]')).toHaveCount(1);
	expect(await probe.contextsLive()).toBe(1);
}

test.describe('@webgl Explore', () => {
	test('travels between mountains, settles on each pose and ends a zoom that is in progress', async ({
		page,
		probe
	}) => {
		const requested = await chooseOtherDestination(page);
		await openStage(page);

		await test.step('travels to the destination, settles on its pose and goes idle', async () => {
			await exploreButton(page).click();
			await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');

			await expectIdleAt(page, OLYMPUS);
			expect(requested).toEqual([`?exclude=${ACONCAGUA.slug}`]);
		});

		await test.step('explores again from where it arrived', async () => {
			await exploreButton(page).click();

			await expectIdleAt(page, ACONCAGUA);
			expect(requested).toEqual([`?exclude=${ACONCAGUA.slug}`, `?exclude=${OLYMPUS.slug}`]);
		});

		await test.step('a transition during a zoom cancels the zoom and arrives on the destination', async () => {
			await page.getByRole('button', { name: 'Zoom out' }).click();
			await exploreButton(page).click();

			await expectIdleAt(page, OLYMPUS);
			const settled = (await cameraReading(page))!.displayRangeMeters;
			await framesPass(page, 10);
			expect((await cameraReading(page))!.displayRangeMeters).toBeCloseTo(settled, 0);
		});

		await expectPersistentViewer(page, probe);
	});

	test('a permalink pushed mid-travel wins, and nothing stale lands afterwards', async ({
		page,
		probe
	}) => {
		await chooseOtherDestination(page);
		await openStage(page);

		await exploreButton(page).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await pushRoute(page, PERMALINK);

		await expectIdleAt(page, ACONCAGUA);
		await renderedFor(page, LONGEST_TRAVEL_MS);
		await expectIdleAt(page, ACONCAGUA);
		await expectPersistentViewer(page, probe);
	});

	test('browser Back mid-travel wins, and the abandoned flight never lands', async ({
		page,
		probe
	}) => {
		await chooseOtherDestination(page);
		await openStage(page);
		await recordRoutes(page);

		await exploreButton(page).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(exploreButton(page)).toHaveAttribute('aria-busy', 'true');
		await page.goBack();

		await expectIdleAt(page, ACONCAGUA);
		await renderedFor(page, LONGEST_TRAVEL_MS);
		await expectIdleAt(page, ACONCAGUA);
		await expectPersistentViewer(page, probe);
		expect(await routesStarted(page)).toEqual([`/mountains/${OLYMPUS.slug}`, PERMALINK]);
	});
});
