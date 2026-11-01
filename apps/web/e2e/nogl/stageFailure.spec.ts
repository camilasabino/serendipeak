import { expect, test, type Page } from '@playwright/test';
import { fixture, resetStub } from '../ssr/support';

const MOUNTAIN = fixture<{ slug: string; name: string }>('mountain-complete.json');
const PERMALINK = `/mountains/${MOUNTAIN.slug}`;

const MISSING_TOKEN_MESSAGE = "The 3D globe isn't available on this site.";
const FAILURE_MESSAGE = 'The 3D globe could not be loaded.';
const DETAILS_MESSAGE = 'The mountain details are still available.';

function isLocal(url: URL): boolean {
	return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

// These builds carry no ion token, so the stage never reaches WebGL.
async function watchProviders(page: Page) {
	const providers: string[] = [];
	const engine: string[] = [];
	const pageErrors: string[] = [];

	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('request', (request) => {
		const url = new URL(request.url());
		if (!isLocal(url)) {
			// The editorial photograph is an expected external request; the stage must add none.
			if (!url.hostname.endsWith('wikimedia.org')) {
				providers.push(request.url());
			}
		} else if (url.pathname.startsWith('/cesium/')) {
			engine.push(request.url());
		}
	});
	await page.route(
		(url) => !isLocal(url),
		(route) => route.abort('blockedbyclient')
	);

	return { providers, engine, pageErrors };
}

async function lazyChunkBlocker(page: Page) {
	const html = await (await page.request.get(PERMALINK)).text();
	const initial = new Set(
		[...html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js[^"]*)"/g)].map((m) => m[1]!)
	);
	const state = { blocking: true, blocked: [] as string[] };

	await page.route('**/_next/static/**/*.js*', async (route) => {
		const url = new URL(route.request().url());
		if (state.blocking && !initial.has(`${url.pathname}${url.search}`)) {
			state.blocked.push(url.pathname);
			await route.abort('failed');
			return;
		}
		await route.continue();
	});

	return state;
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl missing 3D configuration', () => {
	test('explains the missing configuration with no viewer, no retry and no provider request', async ({
		page
	}) => {
		const watched = await watchProviders(page);

		await page.goto(PERMALINK);

		const alert = page.locator('main').getByRole('alert');
		await expect(alert).toContainText(MISSING_TOKEN_MESSAGE);
		await expect(alert).toContainText(DETAILS_MESSAGE);
		await expect(alert).not.toContainText(/NEXT_PUBLIC|token|ion/i);
		await expect(alert.getByRole('button')).toHaveCount(0);
		await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
		await expect(page.locator('canvas')).toHaveCount(0);
		await expect(page.locator('.cesium-viewer')).toHaveCount(0);
		await expect(page.getByText(/^Revealing/)).toHaveCount(0);
		expect(watched.providers).toEqual([]);
		expect(watched.engine).toEqual([]);
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps the editorial content readable and the keyboard free', async ({ page }) => {
		await watchProviders(page);

		await page.goto(PERMALINK);
		await expect(page.locator('main').getByRole('alert')).toBeVisible();

		await expect(page.getByRole('heading', { level: 1 })).toHaveText(MOUNTAIN.name);
		await page.getByRole('link').first().focus();
		let reachedFooter = false;
		for (let presses = 0; presses < 60 && !reachedFooter; presses += 1) {
			await page.keyboard.press('Tab');
			reachedFooter = await page.evaluate(() => document.activeElement?.closest('footer') !== null);
		}
		expect(reachedFooter).toBe(true);
	});
});

test.describe('@nogl stage code failure', () => {
	test('replaces the loader with a retryable failure and recovers by reloading only the chunk', async ({
		page
	}) => {
		const watched = await watchProviders(page);
		const chunks = await lazyChunkBlocker(page);

		await page.goto(PERMALINK);

		const alert = page.locator('main').getByRole('alert');
		await expect(alert).toContainText(FAILURE_MESSAGE);
		await expect(alert).toContainText(DETAILS_MESSAGE);
		await expect(page.getByText(/^Revealing/)).toHaveCount(0);
		expect(chunks.blocked.length).toBeGreaterThan(0);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(MOUNTAIN.name);
		const documentRequests: string[] = [];
		page.on('request', (request) => {
			if (request.resourceType() === 'document') documentRequests.push(request.url());
		});

		chunks.blocking = false;
		const retry = page.getByRole('button', { name: 'Try again' });
		await retry.focus();
		await page.keyboard.press('Enter');

		await expect(alert).toContainText(MISSING_TOKEN_MESSAGE);
		await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(0);
		await expect(page.getByText(/^Revealing/)).toHaveCount(0);
		await expect(page.locator('[data-stage]')).toBeFocused();
		expect(documentRequests).toEqual([]);
		expect(watched.providers).toEqual([]);
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(MOUNTAIN.name);
	});

	test('offers another retry when the chunk keeps failing', async ({ page }) => {
		await watchProviders(page);
		const chunks = await lazyChunkBlocker(page);
		await page.goto(PERMALINK);
		await expect(page.locator('main').getByRole('alert')).toContainText(FAILURE_MESSAGE);
		const before = chunks.blocked.length;

		await page.getByRole('button', { name: 'Try again' }).click();

		await expect.poll(() => chunks.blocked.length).toBeGreaterThan(before);
		await expect(page.locator('main').getByRole('alert')).toContainText(FAILURE_MESSAGE);
		await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
		await expect(page.getByText(/^Revealing/)).toHaveCount(0);
	});

	test('keeps focus on the stage when retry is pressed and finds the control again after a failure', async ({
		page
	}) => {
		await watchProviders(page);
		const chunks = await lazyChunkBlocker(page);
		await page.goto(PERMALINK);
		const retry = page.getByRole('button', { name: 'Try again' });
		await expect(retry).toBeVisible();
		await expect(retry).not.toBeFocused();

		await retry.focus();
		const before = chunks.blocked.length;
		await page.keyboard.press('Enter');

		await expect.poll(() => chunks.blocked.length).toBeGreaterThan(before);
		await expect(retry).toBeVisible();
		await expect(retry).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(retry).toBeFocused();

		chunks.blocking = false;
		await page.keyboard.press('Enter');
		await expect(page.locator('main').getByRole('alert')).toContainText(MISSING_TOKEN_MESSAGE);
		await expect(page.locator('[data-stage]')).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(page.locator('[data-stage]')).not.toBeFocused();
	});

	test('does not take focus when a failure appears while it is elsewhere', async ({ page }) => {
		await watchProviders(page);
		await lazyChunkBlocker(page);

		await page.goto(PERMALINK);
		await expect(page.locator('main').getByRole('alert')).toContainText(FAILURE_MESSAGE);

		await expect(page.getByRole('button', { name: 'Try again' })).not.toBeFocused();
	});
});
