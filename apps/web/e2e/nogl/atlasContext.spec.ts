import { expect, test, type Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';

// The `regions` scenario (see atlasRanges.spec.ts). Europe holds the Alps, which have one subrange
// (Mont Blanc massif), and Mount Olympus; South America holds the Andes and two mountains with no
// range; Asia holds the Himalaya.
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

const list = (page: Page) => page.getByRole('region', { name: 'Atlas mountains' });
const heading = (page: Page, name: string | RegExp) =>
	list(page).getByRole('heading', { level: 2, name });
const trail = (page: Page) => page.getByRole('navigation', { name: 'Atlas trail' });
const trailLabels = (page: Page) => trail(page).getByRole('button');
const count = (page: Page) => list(page).locator('[aria-live="polite"]');
const filterToggle = (page: Page) =>
	list(page).getByRole('button', { name: /^Filter(, \d+ active)?$/ });
const continent = (page: Page, name: string) =>
	list(page)
		.locator('ul > li > button')
		.filter({ hasText: new RegExp(`^${name}`) });
const rangeButton = (page: Page, name: string) =>
	list(page).getByRole('button', { name: new RegExp(`^${name}(\\d|\\s|$)`) });
const popup = (page: Page) => page.locator('[popover]');
const chips = (page: Page) => list(page).getByRole('list', { name: 'Active filters' });
const chip = (page: Page, name: string) => list(page).getByRole('button', { name });
const matchNames = (page: Page) =>
	list(page)
		.getByRole('list', { name: /^(All|Filtered) mountains/ })
		.locator('li > a > span:first-child');

async function openAtlas(page: Page) {
	await page.goto('/atlas');
	await expect(page.getByRole('heading', { level: 1, name: 'Atlas' })).toBeVisible();
	await page.waitForFunction(() => '__NEXT_DATA__' in window && 'next' in window);
	await expect(filterToggle(page)).toBeVisible();
}

async function openRanges(page: Page, name: string) {
	await continent(page, name).click();
	await list(page)
		.getByRole('button', { name: `Browse mountain ranges in ${name}` })
		.click();
	await expect(heading(page, `${name} mountain ranges`)).toBeFocused();
}

async function expandFilters(page: Page) {
	if ((await filterToggle(page).getAttribute('aria-expanded')) !== 'true') {
		await filterToggle(page).click();
	}
}

async function chooseFrom(page: Page, filter: RegExp, option: RegExp) {
	await expandFilters(page);
	await list(page).getByRole('button', { name: filter }).click();
	await popup(page).getByRole('option', { name: option }).click();
	await expect(popup(page)).toHaveCount(0);
}

const chooseCountry = (page: Page, name: RegExp) => chooseFrom(page, /^Country/, name);
const chooseRange = (page: Page, name: RegExp) => chooseFrom(page, /^Mountain range/, name);

async function chooseSortOrder(page: Page, name: string) {
	await list(page).getByRole('button', { name: /^Sort/ }).click();
	await popup(page).getByRole('option', { name }).click();
	await expect(popup(page)).toHaveCount(0);
}

// True when where the reader is comes before the filter and sort controls in reading order.
const contextPrecedesControls = (page: Page) =>
	page.evaluate(() => {
		const where = document.getElementById('atlas-list-heading');
		const controls = [...document.querySelectorAll('button')].find((button) =>
			/^Filter(, \d+ active)?$/.test(button.getAttribute('aria-label') ?? '')
		);

		return Boolean(
			where &&
			controls &&
			where.compareDocumentPosition(controls) & Node.DOCUMENT_POSITION_FOLLOWING
		);
	});

const overflow = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const historyLength = (page: Page) => page.evaluate(() => window.history.length);

test.beforeEach(async ({ request }) => {
	await resetStub(request);
	await useScenario(request, 'regions');
});

test.describe('@nogl Atlas context: where the reader is, before what they can do', () => {
	test('names the level in the one heading above the controls, and introduces the atlas only at the first', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);
		const lede = page.getByText(/^Explore \d+ mountains on the globe/);

		await expect(heading(page, 'All continents')).toBeVisible();
		await expect(lede).toBeVisible();
		expect(await contextPrecedesControls(page)).toBe(true);

		const levels = [
			async () => {
				await continent(page, 'South America').click();

				return 'South America mountains';
			},
			async () => {
				await list(page)
					.getByRole('button', { name: 'Browse mountain ranges in South America' })
					.click();

				return 'South America mountain ranges';
			},
			async () => {
				await rangeButton(page, 'Andes').click();

				return 'Andes';
			},
			async () => {
				await list(page)
					.getByRole('button', { name: /^Principal Cordillera/ })
					.click();

				return 'Principal Cordillera';
			}
		];
		for (const go of levels) {
			const name = await go();

			await expect(heading(page, name)).toBeFocused();
			await expect(list(page).getByRole('heading', { level: 2 })).toHaveCount(1);
			await expect(page.getByRole('heading', { level: 1, name: 'Atlas' })).toBeVisible();
			await expect(lede).toBeHidden();
			expect(await contextPrecedesControls(page)).toBe(true);
		}
		expect(watched.pageErrors).toEqual([]);
	});

	test('does not call a list of continents all mountains', async ({ page }) => {
		await watch(page);
		await openAtlas(page);

		await expect(list(page).getByRole('heading', { name: 'All mountains' })).toHaveCount(0);
		await expect(list(page).locator('ul > li > button')).toHaveCount(3);
	});

	test('says how many mountains a continent or range holds once, not again beside the controls', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await continent(page, 'South America').click();

		await expect(list(page).getByText('4 mountains', { exact: true })).toBeVisible();
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
	});
});

test.describe('@nogl Atlas context: going back through the ranges', () => {
	test('climbs from a nested range to its ancestors, then the continent’s ranges, mountains and all continents', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		const before = await historyLength(page);
		await openRanges(page, 'Europe');

		await rangeButton(page, 'Alps').click();
		await list(page)
			.getByRole('button', { name: /^Mont Blanc massif/ })
			.click();
		await expect(heading(page, 'Mont Blanc massif')).toBeFocused();
		await expect(trailLabels(page)).toHaveText(['Europe mountain ranges', 'Alps']);

		await trail(page).getByRole('button', { name: 'Back to Alps' }).click();
		await expect(heading(page, 'Alps')).toBeFocused();
		await expect(trailLabels(page)).toHaveText(['Europe mountain ranges']);

		await trail(page).getByRole('button', { name: 'Back to Europe mountain ranges' }).click();
		await expect(heading(page, 'Europe mountain ranges')).toBeFocused();
		await expect(rangeButton(page, 'Alps')).toBeVisible();
		await expect(trail(page).getByRole('button')).toHaveText(['Europe mountains']);

		await trail(page).getByRole('button', { name: 'Back to Europe mountains' }).click();
		await expect(heading(page, 'Europe mountains')).toBeFocused();

		await trail(page).getByRole('button', { name: 'Back to All continents' }).click();
		await expect(heading(page, 'All continents')).toBeVisible();
		await expect(continent(page, 'Europe')).toBeFocused();
		expect(await historyLength(page)).toBe(before);
	});

	test('jumps from a nested range straight to the continent’s ranges, skipping no level it came by', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'Europe');
		await rangeButton(page, 'Alps').click();
		await list(page)
			.getByRole('button', { name: /^Mont Blanc massif/ })
			.click();

		await trail(page).getByRole('button', { name: 'Europe mountain ranges' }).click();

		await expect(heading(page, 'Europe mountain ranges')).toBeFocused();
		await expect(trail(page).getByRole('button')).toHaveText(['Europe mountains']);
	});

	test('returns a root range entered through the continent’s ranges to those ranges, not its mountains', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'Europe');
		await rangeButton(page, 'Mount Olympus').click();

		await expect(trailLabels(page)).toHaveText(['Europe mountain ranges']);
		await trailLabels(page).click();

		await expect(heading(page, 'Europe mountain ranges')).toBeFocused();
	});

	test('returns a range chosen from the filter, while the continent’s mountains are shown, to those mountains', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await continent(page, 'South America').click();

		await chooseRange(page, /^Andes/);

		await expect(heading(page, 'Andes')).toBeVisible();
		await expect(trailLabels(page)).toHaveText(['South America mountains']);
		await trailLabels(page).click();
		await expect(heading(page, 'South America mountains')).toBeFocused();
		await expect(
			list(page).getByRole('button', { name: 'Browse mountain ranges in South America' })
		).toBeVisible();
	});

	test('starts the way up at the atlas for a range chosen from the filter alone, inventing no step', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);

		await chooseRange(page, /^Andes/);

		await expect(heading(page, 'Andes')).toBeVisible();
		await expect(trailLabels(page)).toHaveText(['All continents']);
		await trailLabels(page).click();
		await expect(heading(page, 'All continents')).toBeFocused();
		await expect(continent(page, 'South America')).toBeVisible();
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
	});

	test('names the flat list the filters leave as where the way up from a range leads', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await chooseCountry(page, /^Argentina/);
		await expect(heading(page, 'Filtered mountains')).toBeVisible();

		await chooseRange(page, /^Andes/);

		await expect(trailLabels(page)).toHaveText(['Filtered mountains']);
		await trailLabels(page).click();
		await expect(heading(page, 'Filtered mountains')).toBeFocused();
		await expect(matchNames(page)).toHaveText(['Aconcagua', 'Fitz Roy']);
		await expect(chip(page, 'Remove Country: Argentina')).toBeVisible();
	});

	test('is operated from the keyboard, with focus on the heading of the level it arrives at', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'Europe');
		await rangeButton(page, 'Alps').focus();
		await page.keyboard.press('Enter');
		await expect(heading(page, 'Alps')).toBeFocused();

		await page.keyboard.press('Shift+Tab');
		await expect(trailLabels(page)).toBeFocused();
		await page.keyboard.press('Space');
		await expect(heading(page, 'Europe mountain ranges')).toBeFocused();

		await page.keyboard.press('Shift+Tab');
		await expect(trailLabels(page)).toBeFocused();
		await page.keyboard.press('Enter');
		await expect(heading(page, 'Europe mountains')).toBeFocused();
	});
});

test.describe('@nogl Atlas context: sorted and filtered results', () => {
	test('says the list is flat and how it is ordered, and goes back to the continents by clearing the sort', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await expect(list(page).getByRole('button', { name: /^Sort/ })).toHaveAccessibleName(
			'Sort Name A–Z'
		);

		await chooseSortOrder(page, 'Highest first');

		await expect(heading(page, 'All mountains · Highest first')).toBeVisible();
		await expect(matchNames(page).first()).toHaveText('Mount Everest');
		await expect(page.getByText(/^Explore \d+ mountains/)).toBeHidden();
		const back = trail(page).getByRole('button');
		await expect(back).toHaveText('Browse by continent');
		await expect(back).toHaveAccessibleName('Browse by continent, clearing sort');
		expect(await contextPrecedesControls(page)).toBe(true);

		await back.click();

		await expect(heading(page, 'All continents')).toBeFocused();
		await expect(continent(page, 'Europe')).toBeVisible();
		await expect(list(page).getByRole('button', { name: /^Sort/ })).toHaveAccessibleName(
			'Sort Name A–Z'
		);
		await expect(count(page)).toContainText('Sort cleared.');
		await expect(page.getByText(/^Explore \d+ mountains/)).toBeVisible();
	});

	test('says filtered, and says plainly that going back to the continents clears the filters too', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await chooseCountry(page, /^Argentina/);
		await chooseSortOrder(page, 'Lowest first');

		await expect(heading(page, 'Filtered mountains · Lowest first')).toBeVisible();
		const back = trail(page).getByRole('button');
		await expect(back).toHaveAccessibleName('Browse by continent, clearing filters and sort');

		await back.click();

		await expect(heading(page, 'All continents')).toBeFocused();
		await expect(chips(page)).toHaveCount(0);
		await expect(filterToggle(page)).toHaveAccessibleName('Filter');
		await expect(count(page)).toContainText('Filters and sort cleared.');
		await expect(count(page)).toContainText(`Showing all ${TOTAL} mountains`);
	});

	test('does not reset a filter as a side effect of sorting, and keeps Reset as it was', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await chooseCountry(page, /^Argentina/);

		await chooseSortOrder(page, 'Highest first');

		await expect(heading(page, 'Filtered mountains · Highest first')).toBeVisible();
		await expect(chip(page, 'Remove Country: Argentina')).toBeVisible();
		await expect(count(page)).toHaveText(`Showing 2 of ${TOTAL} mountains`);

		await list(page).getByRole('button', { name: 'Reset filters and sort' }).click();
		await expect(heading(page, 'All continents')).toBeVisible();
		await expect(filterToggle(page)).toBeFocused();
	});

	test('keeps the sort inside a continent, and names the flat list that leaving it leads to', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await continent(page, 'South America').click();

		await chooseSortOrder(page, 'Highest first');

		await expect(heading(page, 'South America mountains')).toBeVisible();
		await expect(
			list(page)
				.getByRole('list', { name: 'South America mountains' })
				.locator('li > a > span:first-child')
				.first()
		).toHaveText('Aconcagua');
		await expect(trailLabels(page)).toHaveAccessibleName('Back to All mountains · Highest first');
		await trailLabels(page).click();
		await expect(heading(page, 'All mountains · Highest first')).toBeFocused();
	});
});

test.describe('@nogl Atlas context: active filters', () => {
	test('shows each active filter as a chip, collapsed or not, and removes it from there', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);
		await expect(chips(page)).toHaveCount(0);

		await chooseCountry(page, /^Argentina/);
		await filterToggle(page).click();
		await expect(filterToggle(page)).toHaveAttribute('aria-expanded', 'false');

		await expect(chips(page).getByRole('listitem')).toHaveCount(1);
		await expect(chip(page, 'Remove Country: Argentina')).toHaveText('Argentina');
		await expect(count(page)).toHaveText(`Showing 2 of ${TOTAL} mountains`);

		await chip(page, 'Remove Country: Argentina').click();

		await expect(chips(page)).toHaveCount(0);
		await expect(filterToggle(page)).toBeFocused();
		await expect(filterToggle(page)).toHaveAccessibleName('Filter');
		await expect(heading(page, 'All continents')).toBeVisible();
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
		expect(watched.pageErrors).toEqual([]);
	});

	test('reads the same state as the controls, so a chip and its button never disagree', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await chooseCountry(page, /^Argentina/);
		await expandFilters(page);
		await list(page)
			.getByRole('button', { name: /^Elevation/ })
			.click();
		await popup(page)
			.getByRole('checkbox', { name: /^6,000–/ })
			.check();
		await page.keyboard.press('Escape');

		await expect(chip(page, 'Remove Elevation: 6,000–6,999 m')).toBeVisible();
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 2 active');
		await expect(list(page).getByRole('button', { name: /^Country Argentina/ })).toBeVisible();

		await chip(page, 'Remove Country: Argentina').click();

		await expect(list(page).getByRole('button', { name: /^Country All countries/ })).toBeVisible();
		await expect(chip(page, 'Remove Elevation: 6,000–6,999 m')).toBeVisible();
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 1 active');
		await chip(page, 'Remove Elevation: 6,000–6,999 m').click();
		await expect(chips(page)).toHaveCount(0);
		await expect(
			list(page).getByRole('button', { name: /^Elevation Any elevation/ })
		).toBeVisible();
	});

	test('can be reached and removed from the keyboard', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await chooseCountry(page, /^Argentina/);
		await filterToggle(page).click();

		await filterToggle(page).focus();
		await page.keyboard.press('Tab');
		await page.keyboard.press('Tab');
		await expect(chip(page, 'Remove Country: Argentina')).toBeFocused();
		await page.keyboard.press('Enter');

		await expect(chips(page)).toHaveCount(0);
		await expect(filterToggle(page)).toBeFocused();
	});

	test('explains a filter with nothing to choose between, does not open it, and keeps a selection reachable', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openRanges(page, 'South America');
		await rangeButton(page, 'Andes').click();
		await list(page)
			.getByRole('button', { name: /^Patagonian Andes/ })
			.click();
		await expandFilters(page);

		const country = list(page).getByRole('button', { name: /^Country/ });
		await expect(country).toHaveAttribute('aria-disabled', 'true');
		await expect(country).toHaveAccessibleDescription('No other countries here');
		await country.focus();
		await page.keyboard.press('ArrowDown');
		await expect(popup(page)).toHaveCount(0);
		await expect(country).toHaveAttribute('aria-expanded', 'false');

		const range = list(page).getByRole('button', { name: /^Mountain range/ });
		await expect(range).not.toHaveAttribute('aria-disabled', 'true');
		await range.click();
		await popup(page)
			.getByRole('option', { name: /^All ranges/ })
			.click();
		await expect(heading(page, 'All continents')).toBeVisible();
		await expect(chips(page)).toHaveCount(0);
	});
});

test.describe('@nogl Atlas context: a narrow screen', () => {
	for (const width of [320, 390]) {
		test(`has no horizontal overflow at ${width} px, with chips and the filters open`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height: 700 });
			await watch(page);
			await openAtlas(page);
			expect(await overflow(page)).toBeLessThanOrEqual(0);

			await chooseCountry(page, /^Argentina/);
			await chooseSortOrder(page, 'Highest first');
			await expandFilters(page);
			await expect(chip(page, 'Remove Country: Argentina')).toBeVisible();
			expect(await overflow(page)).toBeLessThanOrEqual(0);
			const box = await chip(page, 'Remove Country: Argentina').boundingBox();
			expect(box?.height).toBeGreaterThanOrEqual(32);

			await trail(page).getByRole('button').click();
			await openRanges(page, 'Europe');
			await rangeButton(page, 'Alps').click();
			await list(page)
				.getByRole('button', { name: /^Mont Blanc massif/ })
				.click();
			await expect(heading(page, 'Mont Blanc massif')).toBeFocused();
			expect(await overflow(page)).toBeLessThanOrEqual(0);
			for (const crumb of await trailLabels(page).all()) {
				expect((await crumb.boundingBox())?.height).toBeGreaterThanOrEqual(44);
			}
		});
	}

	test('keeps large text readable without overflow', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 700 });
		await watch(page);
		await openAtlas(page);
		await page.addStyleTag({ content: 'html { font-size: 24px; }' });
		await openRanges(page, 'Europe');
		await rangeButton(page, 'Alps').click();
		await list(page)
			.getByRole('button', { name: /^Mont Blanc massif/ })
			.click();
		await expandFilters(page);

		expect(await overflow(page)).toBeLessThanOrEqual(0);
	});
});
