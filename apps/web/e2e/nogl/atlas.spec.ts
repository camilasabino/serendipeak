import { expect, test, type Page } from '@playwright/test';
import { fixture, resetStub, stubRequests } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const OLYMPUS = fixture<Named>('mountain-sparse.json');
const INDEX_PATH = '/api/v1/mountains';

function isLocal(url: URL): boolean {
	return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

async function watch(page: Page) {
	const pageErrors: string[] = [];
	const documents: string[] = [];

	page.on('pageerror', (error) => pageErrors.push(error.message));
	page.on('request', (request) => {
		if (request.resourceType() === 'document') documents.push(request.url());
	});
	await page.route(
		(url) => !isLocal(url),
		(route) => route.abort('blockedbyclient')
	);

	return { pageErrors, documents };
}

const list = (page: Page) => page.getByRole('region', { name: 'Atlas mountains' });
const continent = (page: Page, name: string) =>
	list(page)
		.locator('summary, button')
		.filter({ hasText: new RegExp(`^${name}`) });
const item = (page: Page, name: string) => list(page).getByRole('link', { name: new RegExp(name) });
const backToAtlas = (page: Page) => page.getByRole('link', { name: /Back to atlas/ });
const historyLength = (page: Page) => page.evaluate(() => history.length);

// Hydration attaches the client router; until then a click is a plain document navigation.
async function openAtlas(page: Page, path = '/atlas') {
	await page.goto(path);
	await expect(page.getByRole('heading', { level: 1, name: 'Atlas' })).toBeVisible();
	await page.waitForFunction(() => '__NEXT_DATA__' in window && 'next' in window);
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl Atlas list', () => {
	test('starts with the continents alone, each named with its count and no mountain shown', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);

		await expect(list(page).locator('details')).toHaveCount(0);
		await expect(continent(page, 'Europe')).toHaveText(/Europe\s*2 mountains/);
		await expect(continent(page, 'South America')).toHaveText(/South America\s*1 mountain$/);
		await expect(list(page).getByRole('link')).toHaveCount(0);
	});

	test('goes into one continent, hiding the others, and back to all continents', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);

		await continent(page, 'Europe').click();
		await expect(
			list(page).getByRole('heading', { level: 2, name: 'Europe mountains' })
		).toBeFocused();
		await expect(item(page, OLYMPUS.name)).toBeVisible();
		await expect(item(page, ACONCAGUA.name)).toBeHidden();
		await expect(continent(page, 'South America')).toBeHidden();

		await list(page).getByRole('button', { name: 'All continents' }).click();
		await expect(continent(page, 'Europe')).toBeFocused();
		await expect(item(page, OLYMPUS.name)).toBeHidden();
		await expect(continent(page, 'South America')).toBeVisible();
	});

	test('is operated by keyboard: Enter and Space go in, Tab reaches the way into ranges, then the mountains', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);

		await continent(page, 'Europe').focus();
		await page.keyboard.press('Enter');
		await expect(item(page, OLYMPUS.name)).toBeVisible();
		await list(page).getByRole('button', { name: 'All continents' }).focus();
		await page.keyboard.press('Space');
		await expect(item(page, OLYMPUS.name)).toBeHidden();
		await expect(continent(page, 'Europe')).toBeFocused();

		await page.keyboard.press('Enter');
		// The controls come before what can be explored: Filter, Sort, then the way into the ranges.
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await expect(page.locator(':focus')).toHaveText(/^Browse mountain ranges/);
		await page.keyboard.press('Tab');
		await expect(list(page).getByRole('link').first()).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/mountains\//);
	});

	test('is operated by touch', async ({ browser }) => {
		const context = await browser.newContext({
			hasTouch: true,
			isMobile: true,
			viewport: { width: 375, height: 740 }
		});
		const page = await context.newPage();
		await watch(page);
		await openAtlas(page);

		await continent(page, 'Europe').tap();
		await expect(item(page, OLYMPUS.name)).toBeVisible();
		await item(page, OLYMPUS.name).tap();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await context.close();
	});
});

test.describe('@nogl Atlas navigation', () => {
	test('opens a mountain page by client navigation, as a new history entry', async ({ page }) => {
		const watched = await watch(page);
		await page.goto('/');
		await openAtlas(page);
		const documentsBefore = watched.documents.length;
		const entriesBefore = await historyLength(page);

		await continent(page, 'Europe').click();
		await item(page, OLYMPUS.name).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(OLYMPUS.name);
		await expect(page.getByText('On the atlas')).toHaveCount(0);
		expect(watched.documents.length).toBe(documentsBefore);
		expect(await historyLength(page)).toBe(entriesBefore + 1);
		expect(watched.pageErrors).toEqual([]);
	});

	test('comes back with Back to the atlas as it was left, and goes Forward again', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);
		await continent(page, 'Europe').click();
		await item(page, OLYMPUS.name).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(OLYMPUS.name);

		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await expect(item(page, OLYMPUS.name)).toBeVisible();
		await expect(item(page, ACONCAGUA.name)).toBeHidden();

		await page.goForward();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		expect(watched.pageErrors).toEqual([]);
	});

	test('returns through the Back to atlas link when the mountain was opened from the list', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);
		await continent(page, 'South America').click();
		await item(page, ACONCAGUA.name).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		const documentsBefore = watched.documents.length;

		await backToAtlas(page).click();

		await expect(page).toHaveURL(/\/atlas$/);
		await expect(page.getByRole('heading', { level: 1, name: 'Atlas' })).toBeVisible();
		expect(watched.documents.length).toBe(documentsBefore);
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps the open continents through the return link as well', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await continent(page, 'South America').click();
		await item(page, ACONCAGUA.name).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);

		await backToAtlas(page).click();

		await expect(item(page, ACONCAGUA.name)).toBeVisible();
		await expect(item(page, OLYMPUS.name)).toBeHidden();
	});

	test('sends a legacy selection link to the mountain page', async ({ page }) => {
		const watched = await watch(page);

		await page.goto(`/atlas?mountain=${ACONCAGUA.slug}`);

		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		expect(watched.pageErrors).toEqual([]);
	});

	test('works as plain links and native disclosures before any script runs', async ({
		browser
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();

		await page.goto('/atlas');
		await continent(page, 'Europe').click();
		await item(page, OLYMPUS.name).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();
		await expect(backToAtlas(page)).toHaveCount(0);
		await headerAtlas(page).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await context.close();
	});

	test('covers the stage with an opaque loader, so nothing the globe draws shows through', async ({
		browser
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();

		await page.goto('/atlas');
		const loader = page.locator('[data-stage] [role="status"]', { hasText: 'Preparing the atlas' });
		const background = await loader.evaluate(
			(element) => getComputedStyle(element).backgroundColor
		);

		expect(background).toMatch(/^rgb\(/);
		await context.close();
	});

	test('stays useful without a globe: the failure notice, the list and its links', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);

		await expect(page.locator('main [role="alert"]')).toContainText('3D globe');
		await expect(page.getByRole('button', { name: 'Zoom in' })).toHaveCount(0);
		await expect(page.getByRole('button', { name: /globe rotation|Rotate the globe/ })).toHaveCount(
			0
		);
		await continent(page, 'South America').click();
		await item(page, ACONCAGUA.name).click();
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		expect(watched.pageErrors).toEqual([]);
	});

	test('reuses the index it was rendered with for search: no second request', async ({
		page,
		request
	}) => {
		await watch(page);
		await openAtlas(page);
		const before = (await stubRequests(request)).filter((path) => path === INDEX_PATH);

		await page.getByRole('button', { name: 'Search mountains' }).click();
		const dialog = page.getByRole('dialog', { name: 'Search mountains' });
		await expect(dialog.getByRole('status')).toHaveText('Type to search 3 mountains.');
		await dialog.getByRole('combobox').fill('olymp');
		await dialog.getByRole('option', { name: /Mount Olympus/ }).click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));

		// Only the server's render of the atlas asked for it.
		expect(before).toEqual([INDEX_PATH]);
		expect((await stubRequests(request)).filter((path) => path === INDEX_PATH)).toEqual(before);
	});

	test('is reached from the header, which marks it current', async ({ page }) => {
		const watched = await watch(page);
		await page.goto('/');
		await page.waitForFunction(() => 'next' in window);
		const atlasLink = page
			.getByRole('navigation', { name: 'Primary' })
			.getByRole('link', { name: 'Atlas' });

		await atlasLink.click();

		await expect(page).toHaveURL(/\/atlas$/);
		await expect(atlasLink).toHaveAttribute('aria-current', 'page');
		expect(watched.pageErrors).toEqual([]);
	});
});

const atlasHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Atlas' });
const mountainHeading = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const headerAtlas = (page: Page) =>
	page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: 'Atlas' });

// Home, then the atlas through the header: the atlas sits one entry above a page that is not a mountain.
async function openAtlasFromHome(page: Page) {
	await page.goto('/');
	await page.waitForFunction(() => '__NEXT_DATA__' in window && 'next' in window);
	await headerAtlas(page).click();
	await expect(atlasHeading(page)).toBeVisible();
}

// The atlas keeps the continent it was left on, so the way is back to all continents first.
async function openMountainFromAtlas(page: Page, group: string, name: string) {
	const allContinents = list(page).getByRole('button', { name: 'All continents' });
	if (await allContinents.isVisible()) {
		await allContinents.click();
	}
	await continent(page, group).click();
	await item(page, name).click();
	await expect(mountainHeading(page, name)).toBeVisible();
}

test.describe('@nogl Atlas history', () => {
	test('Atlas, Mountain, Back to atlas steps back: no second atlas entry, Back leaves the atlas', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);
		const documentsBefore = watched.documents.length;

		await backToAtlas(page).click();

		await expect(page).toHaveURL(/\/atlas$/);
		await expect(atlasHeading(page)).toBeVisible();
		expect(watched.documents.length).toBe(documentsBefore);

		await page.goBack();
		await expect(page).toHaveURL(/\/$/);
		await page.goForward();
		await expect(page).toHaveURL(/\/atlas$/);
		await page.goForward();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		expect(watched.pageErrors).toEqual([]);
	});

	test('Atlas, Mountain, browser Back is the same step as the link', async ({ page }) => {
		await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);

		await page.goBack();
		await expect(page).toHaveURL(/\/atlas$/);
		await page.goBack();

		await expect(page).toHaveURL(/\/$/);
	});

	test('a mountain opened directly pushes the atlas from the header, so Back returns to the mountain', async ({
		page
	}) => {
		const watched = await watch(page);
		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await page.waitForFunction(() => 'next' in window);
		const documentsBefore = watched.documents.length;

		await headerAtlas(page).click();
		await expect(atlasHeading(page)).toBeVisible();
		expect(watched.documents.length).toBe(documentsBefore);

		await page.goBack();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();
	});

	test('keeps stepping back after the reader went Back to the atlas and Forward again', async ({
		page
	}) => {
		await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);
		await page.goBack();
		await expect(atlasHeading(page)).toBeVisible();
		await page.goForward();
		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();

		await backToAtlas(page).click();
		await expect(page).toHaveURL(/\/atlas$/);
		await page.goBack();

		await expect(page).toHaveURL(/\/$/);
	});

	test('repeated trips between the atlas and mountains never stack atlas entries', async ({
		page
	}) => {
		await watch(page);
		await openAtlasFromHome(page);

		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);
		await backToAtlas(page).click();
		await expect(atlasHeading(page)).toBeVisible();
		await openMountainFromAtlas(page, 'South America', ACONCAGUA.name);
		await backToAtlas(page).click();
		await expect(atlasHeading(page)).toBeVisible();
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);
		await backToAtlas(page).click();
		await expect(atlasHeading(page)).toBeVisible();

		await page.goBack();
		await expect(page).toHaveURL(/\/$/);
	});

	test('a mountain reached through another mountain offers no way back, and Back restores it', async ({
		page
	}) => {
		await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);
		await page.evaluate((target) => {
			void (
				window as Window & { next?: { router: { push(url: string): Promise<boolean> } } }
			).next!.router.push(target);
		}, `/mountains/${ACONCAGUA.slug}`);
		await expect(mountainHeading(page, ACONCAGUA.name)).toBeVisible();
		await expect(backToAtlas(page)).toHaveCount(0);

		await page.goBack();
		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();
		await expect(backToAtlas(page)).toBeVisible();

		await page.goForward();
		await expect(mountainHeading(page, ACONCAGUA.name)).toBeVisible();
		await expect(backToAtlas(page)).toHaveCount(0);
	});

	test('a modified click is left to the browser: it opens a new tab and keeps this entry', async ({
		page,
		context
	}) => {
		await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);

		const [opened] = await Promise.all([
			context.waitForEvent('page'),
			backToAtlas(page).click({ modifiers: ['ControlOrMeta'] })
		]);

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await opened.waitForLoadState();
		expect(new URL(opened.url()).pathname).toBe('/atlas');
		await opened.close();
	});

	test('a reloaded mountain page offers no way back rather than guess what is below', async ({
		page
	}) => {
		await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);
		await expect(backToAtlas(page)).toBeVisible();
		await page.reload();
		await page.waitForFunction(() => 'next' in window);
		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();
		await expect(backToAtlas(page)).toHaveCount(0);
		await expect(copyLink(page)).toBeVisible();

		await headerAtlas(page).click();
		await expect(atlasHeading(page)).toBeVisible();
		await page.goBack();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
	});
});

const copyLink = (page: Page) => page.getByRole('button', { name: 'Copy link' });
const exploreAnother = (page: Page) => page.getByRole('button', { name: /^Explore another/ });
const searchButton = (page: Page) =>
	page
		.getByRole('navigation', { name: 'Primary' })
		.getByRole('button', { name: 'Search mountains' });

async function openMountainFromSearch(page: Page, query: string, name: string) {
	await searchButton(page).click();
	const box = page.getByRole('dialog', { name: 'Search mountains' }).getByRole('combobox');
	await expect(box).toBeFocused();
	await box.fill(query);
	await page.getByRole('option', { name: new RegExp(name) }).click();
	await expect(mountainHeading(page, name)).toBeVisible();
}

test.describe('@nogl Back to atlas link origin', () => {
	test('is offered on a mountain opened from the atlas list, in the first render of the page', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlasFromHome(page);
		await continent(page, 'Europe').click();

		await item(page, OLYMPUS.name).click();
		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();

		expect(await backToAtlas(page).count()).toBe(1);
		await expect(copyLink(page)).toBeVisible();
		expect(watched.pageErrors).toEqual([]);
	});

	test('is not offered on a permalink opened directly, which keeps its share control and header', async ({
		page
	}) => {
		const watched = await watch(page);

		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await page.waitForFunction(() => 'next' in window);

		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();
		await expect(backToAtlas(page)).toHaveCount(0);
		await expect(copyLink(page)).toBeVisible();
		await expect(headerAtlas(page)).toBeVisible();
		await expect(searchButton(page)).toBeVisible();
		expect(watched.pageErrors).toEqual([]);
	});

	test('is not offered on a mountain reached from Today through search', async ({ page }) => {
		const watched = await watch(page);
		await page.goto('/');
		await page.waitForFunction(() => '__NEXT_DATA__' in window && 'next' in window);

		await openMountainFromSearch(page, 'olymp', OLYMPUS.name);

		await expect(backToAtlas(page)).toHaveCount(0);
		await expect(copyLink(page)).toBeVisible();
		expect(watched.pageErrors).toEqual([]);
	});

	test('is not offered on a mountain reached from Today through Explore another', async ({
		page
	}) => {
		const watched = await watch(page);
		await page.goto('/');
		await page.waitForFunction(() => '__NEXT_DATA__' in window && 'next' in window);
		const daily = await page.getByRole('heading', { level: 1 }).innerText();

		await exploreAnother(page).click();

		await expect(page).toHaveURL(/\/mountains\//);
		await expect(page.getByRole('heading', { level: 1 })).not.toHaveText(daily);
		await expect(backToAtlas(page)).toHaveCount(0);
		await expect(copyLink(page)).toBeVisible();
		expect(watched.pageErrors).toEqual([]);
	});

	test('leaves an atlas mountain through search or Explore without the link, and Back brings it again', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);
		await expect(backToAtlas(page)).toBeVisible();

		await openMountainFromSearch(page, 'aconc', ACONCAGUA.name);
		await expect(backToAtlas(page)).toHaveCount(0);

		await page.goBack();
		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();
		await expect(backToAtlas(page)).toBeVisible();

		await exploreAnother(page).click();
		await expect(mountainHeading(page, OLYMPUS.name)).toBeHidden();
		await expect(backToAtlas(page)).toHaveCount(0);
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps the link through Back and Forward between the atlas and the mountain', async ({
		page
	}) => {
		await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);

		await page.goBack();
		await expect(atlasHeading(page)).toBeVisible();
		await page.goForward();

		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();
		await expect(backToAtlas(page)).toBeVisible();
	});

	test('is not offered on a mountain searched for while the atlas is open', async ({ page }) => {
		const watched = await watch(page);
		await openAtlasFromHome(page);

		await openMountainFromSearch(page, 'olymp', OLYMPUS.name);

		await expect(backToAtlas(page)).toHaveCount(0);
		await expect(copyLink(page)).toBeVisible();
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps Back and Forward of a searched mountain, and offers the link again from the list', async ({
		page
	}) => {
		await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromSearch(page, 'olymp', OLYMPUS.name);

		await page.goBack();
		await expect(atlasHeading(page)).toBeVisible();
		await page.goForward();
		await expect(mountainHeading(page, OLYMPUS.name)).toBeVisible();
		await expect(backToAtlas(page)).toHaveCount(0);

		await headerAtlas(page).click();
		await expect(atlasHeading(page)).toBeVisible();
		await openMountainFromAtlas(page, 'South America', ACONCAGUA.name);
		await expect(backToAtlas(page)).toBeVisible();
	});
});

test.describe('@nogl Atlas layout', () => {
	for (const width of [320, 375, 430]) {
		test(`stacks the globe above the panel at ${width} px, without horizontal scroll`, async ({
			page
		}) => {
			await watch(page);
			await page.setViewportSize({ width, height: 740 });
			await openAtlas(page);

			const stage = await page.locator('[data-stage]').boundingBox();
			const heading = await page.getByRole('heading', { level: 1, name: 'Atlas' }).boundingBox();
			expect(stage!.y + stage!.height).toBeLessThanOrEqual(heading!.y);
			expect(stage!.height).toBeGreaterThan(740 * 0.5);

			const summaries = await list(page)
				.locator('summary, ul > li > button')
				.evaluateAll((all) => all.map((summary) => summary.getBoundingClientRect()));
			for (const box of summaries) {
				expect(box.height).toBeGreaterThanOrEqual(44);
				expect(box.right).toBeLessThanOrEqual(width);
			}

			await continent(page, 'Europe').click();
			await item(page, OLYMPUS.name).scrollIntoViewIfNeeded();
			await expect(item(page, OLYMPUS.name)).toBeInViewport();
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
			).toBeLessThanOrEqual(0);
		});
	}

	test('puts the panel beside the globe on a desktop', async ({ page }) => {
		await watch(page);
		await page.setViewportSize({ width: 1280, height: 800 });
		await openAtlas(page);

		const stage = await page.locator('[data-stage]').boundingBox();
		const heading = await page.getByRole('heading', { level: 1, name: 'Atlas' }).boundingBox();
		expect(heading!.x).toBeGreaterThanOrEqual(stage!.x + stage!.width - 1);
	});
});
