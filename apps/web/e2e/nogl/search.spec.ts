import { expect, test, type Page, type Route } from '@playwright/test';
import { fixture, resetStub, stubRequests, useScenario } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const BARE_PEAK = fixture<Named>('mountain-minimal.json');
const OLYMPUS = fixture<Named>('mountain-sparse.json');
const DAILY = fixture<{ mountain: Named }>('daily-mountain.json').mountain;

const INDEX_PATH = '/api/v1/mountains';
const INDEX_ENDPOINT = /\/api\/v1\/mountains(\?.*)?$/;

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

const searchButton = (page: Page) =>
	page
		.getByRole('navigation', { name: 'Primary' })
		.getByRole('button', { name: 'Search mountains' });
const dialog = (page: Page) => page.getByRole('dialog', { name: 'Search mountains' });
const searchBox = (page: Page) => dialog(page).getByRole('combobox', { name: 'Mountain name' });
const results = (page: Page) => dialog(page).getByRole('listbox', { name: 'Matching mountains' });
const option = (page: Page, name: string | RegExp) => results(page).getByRole('option', { name });
const status = (page: Page) => dialog(page).getByRole('status');
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

async function indexRequests(request: Parameters<typeof stubRequests>[0]) {
	return (await stubRequests(request)).filter((path) => path === INDEX_PATH);
}

async function openSearch(page: Page) {
	await searchButton(page).click();
	await expect(dialog(page)).toBeVisible();
	await expect(searchBox(page)).toBeFocused();
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl Mountain search', () => {
	test('finds a mountain from the daily page and opens its permalink, and Back returns', async ({
		page,
		request
	}) => {
		const watched = await watch(page);
		await page.goto('/');
		await expect(heading(page)).toHaveText(DAILY.name);
		expect(await indexRequests(request)).toEqual([]);
		const documentsBefore = watched.documents.length;

		await openSearch(page);
		await expect(status(page)).toHaveText('Type to search 3 mountains.');
		await searchBox(page).fill('OLÝMP');

		await expect(status(page)).toHaveText('1 mountain found.');
		await expect(option(page, /Mount Olympus/)).toContainText('Greece · 2,918 m');
		await option(page, /Mount Olympus/).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(heading(page)).toHaveText(OLYMPUS.name);
		await expect(heading(page)).toBeFocused();
		await expect(dialog(page)).toHaveCount(0);
		expect(watched.documents.length).toBe(documentsBefore);

		await page.goBack();
		await expect(page).toHaveURL(/\/$/);
		await expect(heading(page)).toHaveText(DAILY.name);
		expect(watched.pageErrors).toEqual([]);
	});

	test('works from About and reuses the index it already loaded', async ({ page, request }) => {
		const watched = await watch(page);
		await page.goto('/about');

		await openSearch(page);
		await searchBox(page).fill('bare');
		await expect(option(page, /Bare Peak/)).toBeVisible();
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');

		await expect(page).toHaveURL(new RegExp(`/mountains/${BARE_PEAK.slug}$`));
		await expect(heading(page)).toHaveText(BARE_PEAK.name);

		await openSearch(page);
		await expect(searchBox(page)).toHaveValue('');
		await searchBox(page).fill('aconc');
		await expect(option(page, /Aconcagua/)).toBeVisible();
		expect(await indexRequests(request)).toEqual([INDEX_PATH]);
		expect(watched.pageErrors).toEqual([]);
	});

	test('is operated entirely by keyboard from a permalink', async ({ page }) => {
		await watch(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await searchButton(page).focus();
		await page.keyboard.press('Enter');
		await expect(searchBox(page)).toBeFocused();

		await page.keyboard.type('a');
		const options = results(page).getByRole('option');
		await expect(options).toHaveText([/^Aconcagua/, /^Bare Peak/]);
		await expect(searchBox(page)).not.toHaveAttribute('aria-activedescendant', /.+/);

		await page.keyboard.press('ArrowDown');
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('ArrowUp');
		await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');
		await expect(searchBox(page)).toHaveAttribute(
			'aria-activedescendant',
			(await options.nth(1).getAttribute('id')) ?? ''
		);
		await expect(searchBox(page)).toBeFocused();

		await page.keyboard.press('Enter');

		await expect(page).toHaveURL(new RegExp(`/mountains/${BARE_PEAK.slug}$`));
		await expect(heading(page)).toHaveText(BARE_PEAK.name);
		await expect(heading(page)).toBeFocused();
	});

	test('typing alone never selects: Enter opens nothing until an arrow key chose a result', async ({
		page
	}) => {
		await watch(page);
		await page.goto('/about');
		await openSearch(page);
		const options = results(page).getByRole('option');

		await page.keyboard.type('a');
		await expect(options).toHaveText([/^Aconcagua/, /^Bare Peak/]);
		await expect(searchBox(page)).not.toHaveAttribute('aria-activedescendant', /.+/);
		await expect(results(page).locator('[aria-selected="true"]')).toHaveCount(0);

		await page.keyboard.press('Enter');
		await expect(dialog(page)).toBeVisible();
		await expect(page).toHaveURL(/\/about$/);
		await expect(searchBox(page)).toBeFocused();

		await page.keyboard.press('ArrowDown');
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Enter');

		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await expect(heading(page)).toHaveText(ACONCAGUA.name);
	});

	test('does not open the only match on Enter, and opens it after an explicit selection', async ({
		page
	}) => {
		await watch(page);
		await page.goto('/about');
		await openSearch(page);

		await searchBox(page).fill('olymp');
		await expect(status(page)).toHaveText('1 mountain found.');
		await page.keyboard.press('Enter');
		await expect(dialog(page)).toBeVisible();
		await expect(page).toHaveURL(/\/about$/);
		await expect(option(page, /Mount Olympus/)).toHaveAttribute('aria-selected', 'false');

		await page.keyboard.press('ArrowUp');
		await expect(option(page, /Mount Olympus/)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Enter');

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
	});

	test('changing the query drops the selection, so Enter cannot open a stale result', async ({
		page
	}) => {
		await watch(page);
		await page.goto('/about');
		await openSearch(page);
		const options = results(page).getByRole('option');

		await page.keyboard.type('a');
		await expect(options).toHaveCount(2);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');

		await page.keyboard.type('c');
		await expect(options).toHaveText([/^Aconcagua/]);
		await expect(searchBox(page)).not.toHaveAttribute('aria-activedescendant', /.+/);
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'false');

		await page.keyboard.press('Enter');
		await expect(dialog(page)).toBeVisible();
		await expect(page).toHaveURL(/\/about$/);

		await page.keyboard.press('ArrowDown');
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
	});

	test('ignores Enter without results, while loading and after a failure', async ({
		page,
		request
	}) => {
		await watch(page);
		await page.goto('/about');
		await openSearch(page);

		await searchBox(page).fill('kilimanjaro');
		await expect(status(page)).toHaveText('No mountain matches “kilimanjaro”.');
		await page.keyboard.press('ArrowDown');
		await expect(searchBox(page)).not.toHaveAttribute('aria-activedescendant', /.+/);
		await page.keyboard.press('Enter');
		await expect(dialog(page)).toBeVisible();
		await expect(page).toHaveURL(/\/about$/);

		await page.keyboard.press('Escape');
		await useScenario(request, 'server-error');
		await page.goto('/');
		await openSearch(page);
		await expect(status(page)).toHaveText('The mountains could not be loaded.');
		await page.keyboard.type('a');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await expect(dialog(page)).toBeVisible();
		await expect(page).toHaveURL(/\/$/);
	});

	test('closes on Escape, Close and a click outside, returning focus to the button', async ({
		page
	}) => {
		const watched = await watch(page);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);

		await openSearch(page);
		await searchBox(page).fill('olymp');
		await page.keyboard.press('Escape');
		await expect(dialog(page)).toHaveCount(0);
		await expect(searchButton(page)).toBeFocused();

		await openSearch(page);
		await expect(searchBox(page)).toHaveValue('');
		await dialog(page).getByRole('button', { name: 'Close' }).click();
		await expect(dialog(page)).toHaveCount(0);
		await expect(searchButton(page)).toBeFocused();

		await openSearch(page);
		await page.mouse.click(5, page.viewportSize()!.height - 5);
		await expect(dialog(page)).toHaveCount(0);
		await expect(searchButton(page)).toBeFocused();

		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps keyboard focus inside the dialog and the page behind it from scrolling', async ({
		page
	}) => {
		await watch(page);
		await page.setViewportSize({ width: 1024, height: 500 });
		await page.goto('/about');

		await openSearch(page);
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
			'hidden'
		);
		// The page behind is inert: Tab cycles through the dialog, passing only through the browser's
		// own interface, where the document has no focused element.
		for (let step = 0; step < 4; step += 1) {
			await page.keyboard.press('Tab');
			const focusIsBehind = await dialog(page).evaluate(
				(node) => !node.contains(document.activeElement) && document.activeElement !== document.body
			);
			expect(focusIsBehind).toBe(false);
		}

		await page.keyboard.press('Escape');
		expect(await page.evaluate(() => getComputedStyle(document.documentElement).overflow)).toBe(
			'visible'
		);
	});

	test('announces loading while the index is on its way, then the prompt', async ({ page }) => {
		await watch(page);
		let release!: () => void;
		const gate = new Promise<void>((resolve) => (release = resolve));
		await page.route(INDEX_ENDPOINT, async (route: Route) => {
			await gate;
			await route.continue();
		});
		await page.goto('/');

		await openSearch(page);
		await expect(status(page)).toHaveText('Loading mountains…');
		await searchBox(page).fill('aconc');
		await expect(results(page)).toHaveCount(0);
		release();

		await expect(option(page, /Aconcagua/)).toBeVisible();
		await expect(status(page)).toHaveText('1 mountain found.');
	});

	test('says when no mountain matches', async ({ page }) => {
		await watch(page);
		await page.goto('/');

		await openSearch(page);
		await searchBox(page).fill('kilimanjaro');

		await expect(status(page)).toHaveText('No mountain matches “kilimanjaro”.');
		await expect(results(page)).toHaveCount(0);
		await expect(searchBox(page)).toHaveAttribute('aria-expanded', 'false');
	});

	for (const [scenario, message] of [
		['unreachable', 'Mountain data is unavailable right now.'],
		['server-error', 'The mountains could not be loaded.'],
		['malformed', 'The mountains could not be loaded.']
	] as const) {
		test(`reports a ${scenario} index, stays on the page and recovers with Try again`, async ({
			page,
			request
		}) => {
			const watched = await watch(page);
			await page.goto(`/mountains/${ACONCAGUA.slug}`);
			await useScenario(request, scenario);

			await openSearch(page);
			await expect(status(page)).toHaveText(message);
			await expect(dialog(page)).not.toContainText(/50\d|error|stack/i);
			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));

			await useScenario(request, 'ok');
			await dialog(page).getByRole('button', { name: 'Try again' }).click();
			await expect(searchBox(page)).toBeFocused();
			await expect(status(page)).toHaveText('Type to search 3 mountains.');
			await page.keyboard.type('olymp');
			await expect(option(page, /Mount Olympus/)).toBeVisible();
			expect(watched.pageErrors).toEqual([]);
		});
	}
});

test.describe('@nogl Mountain search on a narrow screen', () => {
	test.use({ hasTouch: true });

	for (const width of [320, 360, 390]) {
		test(`fits the header and the dialog at ${width} px`, async ({ page }) => {
			await watch(page);
			await page.setViewportSize({ width, height: 700 });

			for (const path of ['/', `/mountains/${ACONCAGUA.slug}`, '/about']) {
				await page.goto(path);
				await expect(searchButton(page)).toBeVisible();
				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth
				);
				expect(overflow, path).toBe(0);
				const button = await searchButton(page).boundingBox();
				expect(button?.width).toBeGreaterThanOrEqual(44);
				expect(button?.height).toBeGreaterThanOrEqual(44);
			}

			await searchButton(page).tap();
			await expect(searchBox(page)).toBeFocused();
			await searchBox(page).fill('o');
			const panel = await dialog(page).boundingBox();
			expect(panel?.x).toBeGreaterThanOrEqual(0);
			expect((panel?.x ?? 0) + (panel?.width ?? 0)).toBeLessThanOrEqual(width);
			const first = await results(page).getByRole('option').first().boundingBox();
			expect(first?.height).toBeGreaterThanOrEqual(44);

			await results(page)
				.getByRole('option', { name: /Aconcagua/ })
				.tap();
			await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		});
	}
});
