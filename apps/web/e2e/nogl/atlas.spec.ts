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

const list = (page: Page) => page.getByRole('region', { name: 'All mountains' });
const continent = (page: Page, name: string) =>
	list(page)
		.locator('summary')
		.filter({ hasText: new RegExp(`^${name}`) });
const item = (page: Page, name: string) => list(page).getByRole('link', { name: new RegExp(name) });
const backToAtlas = (page: Page) => page.getByRole('link', { name: /Back to atlas/ });
const historyLength = (page: Page) => page.evaluate(() => history.length);
const openGroups = (page: Page) =>
	list(page)
		.locator('details')
		.evaluateAll((groups) => groups.map((group) => (group as HTMLDetailsElement).open));

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
	test('starts with every continent collapsed, each named with its count', async ({ page }) => {
		await watch(page);
		await openAtlas(page);

		expect((await openGroups(page)).every((open) => !open)).toBe(true);
		await expect(continent(page, 'Europe')).toHaveText(/Europe\s*2 mountains/);
		await expect(continent(page, 'South America')).toHaveText(/South America\s*1 mountain$/);
		await expect(item(page, OLYMPUS.name)).toBeHidden();
	});

	test('opens and closes continents by click, several at once', async ({ page }) => {
		await watch(page);
		await openAtlas(page);

		await continent(page, 'Europe').click();
		await continent(page, 'South America').click();
		await expect(item(page, OLYMPUS.name)).toBeVisible();
		await expect(item(page, ACONCAGUA.name)).toBeVisible();

		await continent(page, 'Europe').click();
		await expect(item(page, OLYMPUS.name)).toBeHidden();
		await expect(item(page, ACONCAGUA.name)).toBeVisible();
	});

	test('is operated by keyboard: Enter and Space toggle, Tab reaches the mountains', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);

		await continent(page, 'Europe').focus();
		await page.keyboard.press('Enter');
		await expect(item(page, OLYMPUS.name)).toBeVisible();
		await page.keyboard.press('Space');
		await expect(item(page, OLYMPUS.name)).toBeHidden();

		await page.keyboard.press('Space');
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

	test('returns through the Back to atlas link, also from a page opened directly', async ({
		page
	}) => {
		const watched = await watch(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await page.waitForFunction(() => 'next' in window);
		const documentsBefore = watched.documents.length;

		await backToAtlas(page).click();

		await expect(page).toHaveURL(/\/atlas$/);
		await expect(page.getByRole('heading', { level: 1, name: 'Atlas' })).toBeVisible();
		expect((await openGroups(page)).every((open) => !open)).toBe(true);
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
		await backToAtlas(page).click();
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

// The list keeps its open continents across trips, so a continent is opened only when it is closed.
async function openMountainFromAtlas(page: Page, group: string, name: string) {
	const summary = continent(page, group);
	if (!(await summary.evaluate((node) => (node.parentElement as HTMLDetailsElement).open))) {
		await summary.click();
	}
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

	test('a mountain opened directly pushes the atlas, so Back returns to the mountain', async ({
		page
	}) => {
		const watched = await watch(page);
		await page.goto(`/mountains/${OLYMPUS.slug}`);
		await page.waitForFunction(() => 'next' in window);
		const documentsBefore = watched.documents.length;

		await backToAtlas(page).click();
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

	test('a mountain reached through another mountain pushes the atlas, as any link would', async ({
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

		await backToAtlas(page).click();
		await expect(atlasHeading(page)).toBeVisible();

		await page.goBack();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
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

	test('a reloaded mountain page pushes the atlas rather than guess what is below', async ({
		page
	}) => {
		await watch(page);
		await openAtlasFromHome(page);
		await openMountainFromAtlas(page, 'Europe', OLYMPUS.name);
		await page.reload();
		await page.waitForFunction(() => 'next' in window);

		await backToAtlas(page).click();
		await expect(atlasHeading(page)).toBeVisible();

		await page.goBack();
		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
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
				.locator('summary')
				.evaluateAll((all) => all.map((summary) => summary.getBoundingClientRect()));
			for (const box of summaries) {
				expect(box.height).toBeGreaterThanOrEqual(44);
				expect(box.right).toBeLessThanOrEqual(width);
			}

			await continent(page, 'Europe').click();
			await continent(page, 'South America').click();
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
