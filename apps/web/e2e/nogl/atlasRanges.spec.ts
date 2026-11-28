import { expect, test, type Locator, type Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';

// The `regions` scenario: Andes holds Aconcagua (Principal Cordillera) and Fitz Roy (Patagonian
// Andes); Himalaya and Alps hold one mountain each through a subrange; "Mount Olympus" is a range
// of a single mountain; two peaks have no range at all.
const TOTAL = 8;

function isLocal(url: URL): boolean {
	return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

async function watch(page: Page) {
	const pageErrors: string[] = [];
	page.on('pageerror', (error) => pageErrors.push(error.message));
	await page.route(
		(url) => !isLocal(url),
		(route) => route.abort('blockedbyclient')
	);

	return { pageErrors };
}

// The toggle is named "Filter" or "Filter, N active"; a trail step can read "Filtered mountains".
const FILTER_TOGGLE = /^Filter(, \d+ active)?$/;
const list = (page: Page) => page.getByRole('region', { name: 'Atlas mountains' });
const count = (page: Page) => list(page).locator('[aria-live="polite"]');
const trail = (page: Page) => page.getByRole('navigation', { name: 'Atlas trail' });
const heading = (page: Page, name: string) => list(page).getByRole('heading', { level: 2, name });
const continent = (page: Page, name: string) =>
	list(page)
		.locator('ul > li > button')
		.filter({ hasText: new RegExp(`^${name}`) });
const rangesHeading = (page: Page, name: string) => heading(page, `${name} mountain ranges`);
const mountainsHeading = (page: Page, name: string) => heading(page, `${name} mountains`);
const link = (page: Page, name: RegExp) => list(page).getByRole('link', { name });
const entry = (page: Page, name: string) =>
	list(page).getByRole('button', { name: `Browse mountain ranges in ${name}` });
const backTo = (page: Page, name: string) =>
	list(page).getByRole('button', { name: `Back to ${name} mountains` });
const rangeButton = (page: Page, name: string) =>
	list(page).getByRole('button', { name: new RegExp(`^${name}(\\d|\\s|$)`) });
const matchNames = (page: Page) => list(page).locator('li > a > span:first-child');
const mountainRows = (page: Page) => list(page).locator('li > a');
const backToAtlas = (page: Page) => page.getByRole('link', { name: /Back to atlas/ });

async function openAtlas(page: Page) {
	await page.goto('/atlas');
	await expect(page.getByRole('heading', { level: 1, name: 'Atlas' })).toBeVisible();
	await page.waitForFunction(() => '__NEXT_DATA__' in window && 'next' in window);
	await expect(list(page).getByRole('button', { name: FILTER_TOGGLE })).toBeVisible();
}

async function openRanges(page: Page, name: string) {
	await continent(page, name).click();
	await entry(page, name).click();
	await expect(rangesHeading(page, name)).toBeFocused();
}

const historyLength = (page: Page) => page.evaluate(() => window.history.length);

test.beforeEach(async ({ request }) => {
	await resetStub(request);
	await useScenario(request, 'regions');
});

test.describe('@nogl Atlas ranges: entering from a continent', () => {
	test('goes into a continent: its mountains alone, a heading and a restrained way into its ranges', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);
		await expect(continent(page, 'South America')).toHaveText(/South America\s*4 mountains/);
		await expect(entry(page, 'South America')).toBeHidden();

		await continent(page, 'South America').click();

		await expect(mountainsHeading(page, 'South America')).toBeFocused();
		await expect(entry(page, 'South America')).toHaveText('Browse mountain ranges');
		await expect(rangeButton(page, 'Andes')).toBeHidden();
		await expect(continent(page, 'Europe')).toBeHidden();
		await expect(link(page, /^Aconcagua/)).toBeVisible();
		await expect(link(page, /^Mont Blanc/)).toHaveCount(0);
		expect(watched.pageErrors).toEqual([]);
	});

	test('replaces the continent’s mountains with its ranges and moves focus to their heading', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);

		await openRanges(page, 'South America');

		await expect(rangeButton(page, 'Andes')).toContainText('2 mountains');
		await expect(mountainRows(page)).toHaveCount(0);
		await expect(list(page).locator('details')).toHaveCount(0);
		await expect(backTo(page, 'South America')).toBeVisible();
	});

	test('lists a range of a single mountain, and every top range of the continent', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'Europe');

		await expect(
			list(page).getByRole('list', { name: 'Europe mountain ranges' }).getByRole('button')
		).toHaveText([/^Alps\s*1 mountain/, /^Mount Olympus\s*1 mountain/]);
	});

	test('goes back one level at a time, with focus on the heading, then on the continent', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'South America');

		await backTo(page, 'South America').click();
		await expect(mountainsHeading(page, 'South America')).toBeFocused();
		await expect(link(page, /^Aconcagua/)).toBeVisible();
		await expect(rangeButton(page, 'Andes')).toBeHidden();

		await list(page).getByRole('button', { name: 'All continents' }).click();
		await expect(continent(page, 'South America')).toBeFocused();
		await expect(continent(page, 'Europe')).toBeVisible();
		await expect(list(page).getByRole('link')).toHaveCount(0);
	});

	test('keeps a mountain with no range reachable from its continent', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await continent(page, 'South America').click();

		await expect(link(page, /^Six Thousand/)).toBeVisible();
	});
});

test.describe('@nogl Atlas ranges: browsing', () => {
	test('shows the range, its subranges and its mountains, and moves focus to the range', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);
		await openRanges(page, 'South America');

		await rangeButton(page, 'Andes').click();

		await expect(heading(page, 'Andes')).toBeFocused();
		await expect(trail(page).getByRole('button')).toHaveText(['South America mountain ranges']);
		await expect(
			list(page)
				.locator('p')
				.filter({ hasText: /^2 mountains$/ })
		).toBeVisible();
		await expect(list(page).getByRole('heading', { level: 3 })).toHaveText([
			'Subranges',
			'Mountains'
		]);
		await expect(list(page).getByRole('button', { name: /^Patagonian Andes/ })).toBeVisible();
		await expect(list(page).getByRole('button', { name: /^Principal Cordillera/ })).toBeVisible();
		await expect(matchNames(page)).toHaveText(['Aconcagua', 'Fitz Roy']);
		await expect(count(page)).toHaveText(`Showing 2 of ${TOTAL} mountains`);
		expect(watched.pageErrors).toEqual([]);
	});

	test('says in which subrange each mountain sits', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'South America');
		await rangeButton(page, 'Andes').click();

		await expect(mountainRows(page).nth(0)).toContainText('Principal Cordillera ·');
		await expect(mountainRows(page).nth(1)).toContainText('Patagonian Andes ·');
	});

	test('keeps a range of one mountain to its name, its count and the mountain', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'Europe');

		await rangeButton(page, 'Mount Olympus').click();

		await expect(heading(page, 'Mount Olympus')).toBeFocused();
		await expect(trail(page).getByRole('button')).toHaveText(['Europe mountain ranges']);
		await expect(list(page).getByRole('heading', { level: 3 })).toHaveCount(0);
		await expect(matchNames(page)).toHaveText(['Mount Olympus']);
	});

	test('goes down a subrange and climbs back one level at a time, to the continent and its mountains', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'South America');
		await rangeButton(page, 'Andes').click();

		await list(page)
			.getByRole('button', { name: /^Patagonian Andes/ })
			.click();
		await expect(heading(page, 'Patagonian Andes')).toBeFocused();
		await expect(trail(page).getByRole('button')).toHaveText([
			'South America mountain ranges',
			'Andes'
		]);
		await expect(matchNames(page)).toHaveText(['Fitz Roy']);
		await expect(count(page)).toHaveText(`Showing 1 of ${TOTAL} mountains`);
		await expect(list(page).getByRole('heading', { level: 3 })).toHaveCount(0);

		await trail(page).getByRole('button', { name: 'Andes' }).click();
		await expect(heading(page, 'Andes')).toBeFocused();
		await expect(matchNames(page)).toHaveText(['Aconcagua', 'Fitz Roy']);

		await trail(page).getByRole('button', { name: 'South America' }).click();
		await expect(rangesHeading(page, 'South America')).toBeFocused();
		await expect(trail(page).getByRole('button')).toHaveText(['South America mountains']);
		await expect(rangeButton(page, 'Andes')).toBeVisible();
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);

		await backTo(page, 'South America').click();
		await expect(mountainsHeading(page, 'South America')).toBeFocused();
		await expect(link(page, /^Aconcagua/)).toBeVisible();
	});

	test('works from the keyboard alone, and focus always lands on what is shown', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await continent(page, 'South America').focus();
		await page.keyboard.press('Enter');
		await expect(mountainsHeading(page, 'South America')).toBeFocused();

		// The controls come before what can be explored: Filter, Sort, then the way into the ranges.
		await page.keyboard.press('Tab');
		await expect(list(page).getByRole('button', { name: FILTER_TOGGLE })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(list(page).getByRole('button', { name: /^Sort/ })).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(entry(page, 'South America')).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(rangesHeading(page, 'South America')).toBeFocused();

		await rangeButton(page, 'Andes').focus();
		await page.keyboard.press('Enter');
		await expect(heading(page, 'Andes')).toBeFocused();

		await list(page)
			.getByRole('button', { name: /^Principal Cordillera/ })
			.focus();
		await page.keyboard.press('Space');
		await expect(heading(page, 'Principal Cordillera')).toBeFocused();
		await expect(matchNames(page)).toHaveText(['Aconcagua']);

		// The controls come before the mountains, whatever their number: Tab reaches Filter and Sort,
		// and then the first mountain, which is the one the list leads with.
		const sortButton = list(page).getByRole('button', { name: /^Sort/ });
		const visited: string[] = [];
		for (let presses = 0; presses < 10; presses++) {
			await page.keyboard.press('Tab');
			if (
				await mountainRows(page)
					.first()
					.evaluate((row) => row === document.activeElement)
			) {
				break;
			}
			visited.push(
				await page.evaluate(
					() =>
						document.activeElement?.getAttribute('aria-label') ??
						document.activeElement?.textContent?.trim() ??
						''
				)
			);
		}
		await expect(mountainRows(page).first()).toBeFocused();
		await expect(mountainRows(page).first()).toContainText('Aconcagua');
		expect(visited[0]).toMatch(FILTER_TOGGLE);
		expect(visited[1]).toBe((await sortButton.textContent())?.trim());
	});

	test('adds no history entry and no address to a range', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		const before = await historyLength(page);
		await openRanges(page, 'South America');

		await rangeButton(page, 'Andes').click();
		await list(page)
			.getByRole('button', { name: /^Patagonian Andes/ })
			.click();
		await trail(page).getByRole('button', { name: 'South America' }).click();
		await backTo(page, 'South America').click();

		expect(await historyLength(page)).toBe(before);
		expect(new URL(page.url()).pathname).toBe('/atlas');
		expect(new URL(page.url()).search).toBe('');
	});

	test('keeps the other filters through the way up, and leaves for the atlas by the range filter', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		const chooseRange = async (name: RegExp) => {
			await list(page)
				.getByRole('button', { name: /^Mountain range/ })
				.click();
			await page.locator('[popover]').getByRole('option', { name }).click();
		};
		await openRanges(page, 'South America');
		await list(page).getByRole('button', { name: FILTER_TOGGLE }).click();
		await list(page)
			.getByRole('button', { name: /^Country/ })
			.click();
		await page
			.locator('[popover]')
			.getByRole('option', { name: /^Argentina/ })
			.click();
		await expect(count(page)).toHaveText(`Showing 2 of ${TOTAL} mountains`);

		await chooseRange(/^Andes/);
		await expect(trail(page).getByRole('button')).toHaveText(['South America mountain ranges']);

		await trail(page).getByRole('button', { name: 'South America' }).click();
		await expect(rangesHeading(page, 'South America')).toBeFocused();
		await expect(rangeButton(page, 'Andes')).toContainText('2 mountains');
		await expect(list(page).getByRole('button', { name: /^Country Argentina/ })).toBeVisible();

		await chooseRange(/^Andes/);
		await chooseRange(/^All ranges/);

		await expect(heading(page, 'Filtered mountains')).toBeVisible();
		await expect(trail(page).getByRole('button')).toHaveText(['Browse by continent']);
		await expect(rangesHeading(page, 'South America')).toHaveCount(0);
		await expect(count(page)).toHaveText(`Showing 2 of ${TOTAL} mountains`);
		await expect(matchNames(page)).toHaveText(['Aconcagua', 'Fitz Roy']);
	});
});

test.describe('@nogl Atlas ranges: what the filters offer at each level', () => {
	const popup = (page: Page) => page.locator('[popover]');
	const offered = async (page: Page, filter: RegExp) => {
		await list(page).getByRole('button', { name: filter }).click();
		const names = await popup(page)
			.getByRole('option')
			.evaluateAll((options) => options.map((o) => o.querySelector('span > span')?.textContent));
		await page.keyboard.press('Escape');
		await expect(popup(page)).toHaveCount(0);

		return names;
	};
	const countries = (page: Page) => offered(page, /^Country/);
	const ranges = (page: Page) => offered(page, /^Mountain range/);

	test('offers only what lies within the continent or range, and everything again on the way back', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);
		await list(page).getByRole('button', { name: FILTER_TOGGLE }).click();
		const everyCountry = await countries(page);
		const everyRange = await ranges(page);
		expect(everyCountry).toEqual(expect.arrayContaining(['Nepal', 'France', 'Chile']));
		expect(everyRange).toEqual(expect.arrayContaining(['Himalaya', 'Alps', 'Andes']));

		await continent(page, 'South America').click();
		await expect(mountainsHeading(page, 'South America')).toBeFocused();
		expect(await countries(page)).toEqual(['All countries', 'Argentina', 'Chile']);
		expect(await ranges(page)).toEqual([
			'All ranges',
			'Andes',
			'Patagonian Andes',
			'Principal Cordillera'
		]);

		await entry(page, 'South America').click();
		await rangeButton(page, 'Andes').click();
		await list(page)
			.getByRole('button', { name: /^Patagonian Andes/ })
			.click();
		await expect(heading(page, 'Patagonian Andes')).toBeFocused();
		// Its one mountain lies in both countries, so neither would show fewer: the filter says so.
		await expect(list(page).getByRole('button', { name: /^Country/ })).toHaveAttribute(
			'aria-disabled',
			'true'
		);
		await expect(list(page).getByText('No other countries here')).toBeVisible();
		expect(await ranges(page)).toEqual(['All ranges', 'Patagonian Andes']);

		await trail(page).getByRole('button', { name: 'Andes' }).click();
		expect(await ranges(page)).toEqual([
			'All ranges',
			'Andes',
			'Patagonian Andes',
			'Principal Cordillera'
		]);

		await trail(page).getByRole('button', { name: 'South America' }).click();
		await backTo(page, 'South America').click();
		await list(page).getByRole('button', { name: 'All continents' }).click();
		await expect(continent(page, 'South America')).toBeFocused();
		expect(await countries(page)).toEqual(everyCountry);
		expect(await ranges(page)).toEqual(everyRange);
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps a selection that still holds, and its scope, through a visit to a mountain', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await continent(page, 'South America').click();
		await list(page).getByRole('button', { name: FILTER_TOGGLE }).click();
		await list(page)
			.getByRole('button', { name: /^Country/ })
			.click();
		await popup(page)
			.getByRole('option', { name: /^Argentina/ })
			.click();
		await expect(matchNames(page)).toHaveText(['Aconcagua', 'Fitz Roy']);

		await entry(page, 'South America').click();
		await rangeButton(page, 'Andes').click();
		await expect(list(page).getByRole('button', { name: /^Country Argentina/ })).toBeVisible();
		await link(page, /^Aconcagua/).click();
		await expect(page).toHaveURL(/\/mountains\/aconcagua$/);
		await backToAtlas(page).click();

		await expect(heading(page, 'Andes')).toBeVisible();
		await list(page).getByRole('button', { name: FILTER_TOGGLE }).click();
		await expect(list(page).getByRole('button', { name: /^Country Argentina/ })).toBeVisible();
		expect(await countries(page)).toEqual(['All countries', 'Argentina', 'Chile']);
		expect(await ranges(page)).toEqual([
			'All ranges',
			'Andes',
			'Patagonian Andes',
			'Principal Cordillera'
		]);
	});
});

test.describe('@nogl Atlas ranges: leaving and coming back', () => {
	test('returns from a mountain page to the range as it was left', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'South America');
		await rangeButton(page, 'Andes').click();
		await list(page)
			.getByRole('button', { name: /^Principal Cordillera/ })
			.click();

		await list(page)
			.getByRole('link', { name: /^Aconcagua/ })
			.click();
		await expect(page).toHaveURL(/\/mountains\/aconcagua$/);
		await backToAtlas(page).click();

		await expect(page).toHaveURL(/\/atlas$/);
		await expect(heading(page, 'Principal Cordillera')).toBeVisible();
		await expect(trail(page).getByRole('button')).toHaveText([
			'South America mountain ranges',
			'Andes'
		]);
		await expect(matchNames(page)).toHaveText(['Aconcagua']);
	});

	test('keeps the continent at the head of the trail after a visit to a mountain', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'South America');
		await rangeButton(page, 'Andes').click();

		await list(page)
			.getByRole('link', { name: /^Aconcagua/ })
			.click();
		await expect(page).toHaveURL(/\/mountains\/aconcagua$/);
		await backToAtlas(page).click();

		await expect(heading(page, 'Andes')).toBeVisible();
		await expect(trail(page).getByRole('button')).toHaveText(['South America mountain ranges']);
		await trail(page).getByRole('button', { name: 'South America' }).click();
		await expect(rangeButton(page, 'Andes')).toBeVisible();
	});

	test('returns to the default atlas after Reset, whatever level the reader was on', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'South America');
		await rangeButton(page, 'Andes').click();

		await list(page).getByRole('button', { name: 'Reset filters and sort' }).click();

		await expect(trail(page)).toHaveCount(0);
		await expect(heading(page, 'Andes')).toHaveCount(0);
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
		await expect(continent(page, 'South America')).toBeVisible();
		await expect(rangeButton(page, 'Andes')).toBeHidden();
		await expect(list(page).getByRole('button', { name: /^Back to/ })).toHaveCount(0);
	});
});

test.describe('@nogl Atlas ranges: a narrow screen', () => {
	test('has no horizontal overflow and tappable targets at every level at 320 px', async ({
		page
	}) => {
		await page.setViewportSize({ width: 320, height: 700 });
		await watch(page);
		await openAtlas(page);
		const overflow = () =>
			page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
		const height = async (locator: Locator) => (await locator.first().boundingBox())?.height ?? 0;

		expect(await height(continent(page, 'South America'))).toBeGreaterThanOrEqual(44);
		await continent(page, 'South America').click();
		expect(await height(entry(page, 'South America'))).toBeGreaterThanOrEqual(44);
		await entry(page, 'South America').click();
		expect(await height(backTo(page, 'South America'))).toBeGreaterThanOrEqual(44);
		expect(await height(rangeButton(page, 'Andes'))).toBeGreaterThanOrEqual(44);
		expect(await overflow()).toBeLessThanOrEqual(0);

		await rangeButton(page, 'Andes').click();
		await list(page)
			.getByRole('button', { name: /^Principal Cordillera/ })
			.click();
		await trail(page).getByRole('button', { name: 'Andes' }).click();
		expect(await height(trail(page).getByRole('button'))).toBeGreaterThanOrEqual(44);
		expect(
			await height(list(page).getByRole('button', { name: /^Patagonian Andes/ }))
		).toBeGreaterThanOrEqual(44);
		expect(await overflow()).toBeLessThanOrEqual(0);
	});
});
