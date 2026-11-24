import { expect, test, type Page } from '@playwright/test';
import { fixture, resetStub, stubRequests, useScenario } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const INDEX_PATH = '/api/v1/mountains';

// The `regions` scenario: eight mountains, three of them with pages.
const TOTAL = 8;

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
const filterToggle = (page: Page) => list(page).getByRole('button', { name: /^Filter/ });
type Facet = 'country' | 'range';

const FACET_BUTTON = { country: /^Country/, range: /^Mountain range/ } as const;
const ANY_LABEL = { country: 'All countries', range: 'All ranges' } as const;
const NAMES: Record<Facet, Record<string, string>> = {
	country: {
		AR: 'Argentina',
		CL: 'Chile',
		CN: 'China',
		FR: 'France',
		GR: 'Greece',
		NP: 'Nepal'
	},
	range: {
		andes: 'Andes',
		himalaya: 'Himalaya',
		'principal-cordillera': 'Principal Cordillera'
	}
};

const facet = (page: Page, which: Facet) =>
	list(page).getByRole('button', { name: FACET_BUTTON[which] });
const country = (page: Page) => facet(page, 'country');
const range = (page: Page) => facet(page, 'range');
const popup = (page: Page) => page.locator('[popover]');
const searchField = (page: Page) => popup(page).getByRole('combobox');
const elevation = (page: Page) => list(page).getByRole('button', { name: /^Elevation/ });
const bandBox = (page: Page, floor: number) =>
	list(page).getByRole('checkbox', { name: new RegExp(`^${floor.toLocaleString('en')}–`) });
const clearElevation = (page: Page) =>
	list(page).getByRole('button', { name: 'Clear elevation bands' });
const SORT_NAMES = {
	name: 'Name A–Z',
	'elevation-desc': 'Highest first',
	'elevation-asc': 'Lowest first'
} as const;
type SortValue = keyof typeof SORT_NAMES;
const sort = (page: Page) => list(page).getByRole('button', { name: /^Sort/ });

async function chooseSort(page: Page, value: SortValue) {
	await closePopup(page);
	await sort(page).click();
	await popup(page).getByRole('option', { name: SORT_NAMES[value] }).click();
	await expect(popup(page)).toHaveCount(0);
}

const expectSort = (page: Page, value: SortValue) =>
	expect(sort(page)).toHaveAccessibleName(`Sort ${SORT_NAMES[value]}`);
const reset = (page: Page) => list(page).getByRole('button', { name: 'Reset filters and sort' });
const count = (page: Page) => list(page).locator('[aria-live="polite"]');
const continent = (page: Page, name: string) =>
	list(page)
		.locator('summary')
		.filter({ hasText: new RegExp(`^${name}`) });
const backToAtlas = (page: Page) => page.getByRole('link', { name: /Back to atlas/ });

// The flat list of matches, by name and in order; empty while the continents are showing, whose
// lists are named for their continents. Retries until the list is as expected.
const matchNames = (page: Page) =>
	list(page).getByRole('list', { name: 'All mountains' }).locator('li > a > span:first-child');

const expectNames = (page: Page, expected: string[]) =>
	expect(matchNames(page)).toHaveText(expected);

async function openAtlas(page: Page) {
	await page.goto('/atlas');
	await expect(page.getByRole('heading', { level: 1, name: 'Atlas' })).toBeVisible();
	await page.waitForFunction(() => '__NEXT_DATA__' in window && 'next' in window);
	await expect(filterToggle(page)).toBeVisible();
}

async function openFilters(page: Page) {
	if ((await filterToggle(page).getAttribute('aria-expanded')) !== 'true') {
		await filterToggle(page).click();
	}
	await expect(country(page)).toBeVisible();
}

// Escape closes whichever popup is open; a popup floats over the fields below it, so a test that
// moves on to them closes it first, as a reader's press outside would.
async function closePopup(page: Page) {
	if (await popup(page).count()) {
		await page.keyboard.press('Escape');
		await expect(popup(page)).toHaveCount(0);
	}
}

async function openElevation(page: Page) {
	await openFilters(page);
	if ((await elevation(page).getAttribute('aria-expanded')) !== 'true') {
		await closePopup(page);
		await elevation(page).click();
	}
	await expect(page.getByRole('group', { name: 'Elevation bands' })).toBeVisible();
}

async function pickBand(page: Page, floor: number) {
	await openElevation(page);
	await bandBox(page, floor).check();
	await closePopup(page);
}

async function dropBand(page: Page, floor: number) {
	await openElevation(page);
	await bandBox(page, floor).uncheck();
	await closePopup(page);
}

// Each band as "6,000–6,999 m (2)", read from its checkbox row.
async function bandLabels(page: Page): Promise<string[]> {
	await openElevation(page);
	const rows = await popup(page)
		.locator('label')
		.evaluateAll((labels) =>
			labels.map((label) => {
				const [name, count] = [...(label.querySelector('span')?.children ?? [])];

				return `${name?.textContent} (${count?.firstChild?.textContent})`;
			})
		);
	await closePopup(page);

	return rows;
}

async function openFacet(page: Page, which: Facet) {
	await openFilters(page);
	if ((await facet(page, which).getAttribute('aria-expanded')) !== 'true') {
		await closePopup(page);
		await facet(page, which).click();
	}
	await expect(searchField(page)).toBeFocused();
}

// Picks an option by the code or slug the old selects used; '' is the "all" row.
async function choose(page: Page, which: Facet, value: string) {
	await openFacet(page, which);
	const name = value === '' ? ANY_LABEL[which] : NAMES[which][value]!;
	await popup(page)
		.getByRole('option', { name: new RegExp(`^${name}(\\s+\\d|$)`) })
		.click();
	await expect(popup(page)).toHaveCount(0);
}

async function expectChoice(page: Page, which: Facet, value: string) {
	const name = value === '' ? ANY_LABEL[which] : NAMES[which][value]!;
	await expect(facet(page, which)).toHaveAccessibleName(
		new RegExp(`^${FACET_BUTTON[which].source.slice(1)} ${name}`)
	);
}

// Each option as the old select showed it: the name, the count, and two spaces per level.
async function choiceLabels(page: Page, which: Facet): Promise<string[]> {
	await openFacet(page, which);
	const rows = await popup(page)
		.getByRole('option')
		.evaluateAll((options) =>
			options.map((option) => {
				const name = option.querySelector('span > span')?.textContent ?? '';
				const count = option.lastElementChild?.firstChild?.textContent;
				const indent = '  '.repeat(Number((option as HTMLElement).dataset.depth));

				return count === undefined || option.children.length < 3
					? name
					: `${indent}${name} (${count})`;
			})
		);
	await closePopup(page);

	return rows;
}

async function horizontalOverflow(page: Page): Promise<number> {
	return page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
	await useScenario(request, 'regions');
});

test.describe('@nogl Atlas filters: the default view', () => {
	test('keeps the continents, closed, with the controls collapsed above them', async ({ page }) => {
		const watched = await watch(page);
		await openAtlas(page);

		await expect(continent(page, 'South America')).toHaveText(/South America\s*4 mountains/);
		await expect(continent(page, 'Europe')).toHaveText(/Europe\s*3 mountains/);
		await expectNames(page, []);
		await expect(filterToggle(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(country(page)).toBeHidden();
		await expectSort(page, 'name');
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
		await expect(reset(page)).toHaveCount(0);
		expect(watched.pageErrors).toEqual([]);
	});

	test('offers countries alphabetically, elevation bands and ranges under their parents', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);
		expect(await choiceLabels(page, 'country')).toEqual([
			'All countries',
			'Argentina (2)',
			'Chile (3)',
			'China (1)',
			'France (1)',
			'Greece (1)',
			'Italy (1)',
			'Nepal (1)'
		]);
		await expect(elevation(page)).toHaveAccessibleName('Elevation Any elevation');
		expect(await bandLabels(page)).toEqual([
			'8,000–8,999 m (1)',
			'6,000–6,999 m (2)',
			'5,000–5,999 m (1)',
			'4,000–4,999 m (1)',
			'3,000–3,999 m (1)',
			'2,000–2,999 m (2)'
		]);
		expect(await choiceLabels(page, 'range')).toEqual([
			'All ranges',
			'Alps (1)',
			'  Mont Blanc massif (1)',
			'Andes (2)',
			'  Patagonian Andes (1)',
			'  Principal Cordillera (1)',
			'Himalaya (1)',
			'  Mahalangur (1)',
			'Mount Olympus (1)'
		]);
	});
});

test.describe('@nogl Atlas filters: filtering', () => {
	test('shows a flat list of the matches by name, with the count against the catalog', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'country', 'CL');

		await expectNames(page, ['Almost Six', 'Fitz Roy', 'Six Thousand']);
		await expect(list(page).locator('details')).toHaveCount(0);
		await expect(count(page)).toHaveText(`Showing 3 of ${TOTAL} mountains`);
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 1 active');
		await expect(reset(page)).toBeVisible();
		expect(watched.pageErrors).toEqual([]);
	});

	test('matches a cross-border mountain under each of its countries', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'country', 'AR');
		await expectNames(page, ['Aconcagua', 'Fitz Roy']);

		await choose(page, 'country', 'CL');
		await expect(matchNames(page).filter({ hasText: 'Fitz Roy' })).toHaveCount(1);
		await choose(page, 'country', 'CN');
		await expectNames(page, ['Mount Everest']);
	});

	test('takes the lower bound of an elevation band and not its upper bound', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await pickBand(page, 6000);
		await expectNames(page, ['Aconcagua', 'Six Thousand']);

		await dropBand(page, 6000);
		await pickBand(page, 5000);
		await expectNames(page, ['Almost Six']);

		await dropBand(page, 5000);
		await pickBand(page, 2000);
		await expectNames(page, ['Bare Peak', 'Mount Olympus']);
	});

	test('includes every descendant region of a range, and only its own for a child', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'range', 'andes');
		await expectNames(page, ['Aconcagua', 'Fitz Roy']);

		await choose(page, 'range', 'principal-cordillera');
		await expectNames(page, ['Aconcagua']);

		await choose(page, 'range', '');
		await expect(continent(page, 'Europe')).toBeVisible();
	});

	test('combines compatible filters', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'country', 'AR');
		await pickBand(page, 6000);
		await expectNames(page, ['Aconcagua']);
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 2 active');

		await choose(page, 'range', 'principal-cordillera');
		await expectNames(page, ['Aconcagua']);
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 3 active');
		await expect(count(page)).toHaveText(`Showing 1 of ${TOTAL} mountains`);
	});
});

test.describe('@nogl Atlas filters: faceted options', () => {
	test('offers, after a country, only the elevations and ranges it has', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'country', 'GR');

		await expectNames(page, ['Mount Olympus']);
		expect(await bandLabels(page)).toEqual(['2,000–2,999 m (1)']);
		expect(await choiceLabels(page, 'range')).toEqual(['All ranges', 'Mount Olympus (1)']);
		expect(await choiceLabels(page, 'country')).toContain('Chile (3)');
	});

	test('offers, after an elevation first, only the countries that reach it', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await pickBand(page, 6000);

		expect(await choiceLabels(page, 'country')).toEqual([
			'All countries',
			'Argentina (1)',
			'Chile (1)'
		]);
		expect(await choiceLabels(page, 'range')).toEqual([
			'All ranges',
			'Andes (1)',
			'  Principal Cordillera (1)'
		]);
	});

	test('narrows each facet by the other two, whichever order they were chosen in', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'range', 'andes');
		await choose(page, 'country', 'AR');

		expect(await bandLabels(page)).toEqual(['6,000–6,999 m (1)', '3,000–3,999 m (1)']);

		await reset(page).click();
		await openFilters(page);
		await choose(page, 'country', 'AR');
		await choose(page, 'range', 'andes');

		expect(await bandLabels(page)).toEqual(['6,000–6,999 m (1)', '3,000–3,999 m (1)']);
	});

	test('never leaves an empty list or an option with no mountain', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		for (const step of [
			() => choose(page, 'country', 'NP'),
			() => pickBand(page, 8000),
			() => choose(page, 'range', 'himalaya'),
			() =>
				reset(page)
					.click()
					.then(() => choose(page, 'country', 'FR')),
			() => pickBand(page, 4000),
			() => choose(page, 'range', '')
		]) {
			await step();
			expect(await matchNames(page).count()).toBeGreaterThan(0);
			for (const label of [
				...(await choiceLabels(page, 'country')),
				...(await bandLabels(page)),
				...(await choiceLabels(page, 'range'))
			]) {
				expect(label).not.toMatch(/\(0\)$/);
			}
		}
	});
});

test.describe('@nogl Atlas filters: elevation bands', () => {
	test('selects and deselects several bands, adjacent or not, and summarises them', async ({
		page
	}) => {
		const watched = await watch(page);
		await openAtlas(page);

		await pickBand(page, 6000);
		await expect(elevation(page)).toHaveAccessibleName('Elevation 6,000–6,999 m');
		await pickBand(page, 2000);
		await expect(elevation(page)).toHaveAccessibleName('Elevation 2 elevation bands');
		await expectNames(page, ['Aconcagua', 'Bare Peak', 'Mount Olympus', 'Six Thousand']);
		await expect(count(page)).toHaveText(`Showing 4 of ${TOTAL} mountains`);
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 1 active');

		await dropBand(page, 6000);
		await expect(elevation(page)).toHaveAccessibleName('Elevation 2,000–2,999 m');
		await expectNames(page, ['Bare Peak', 'Mount Olympus']);
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps the exact edge of each band when several are selected', async ({ page }) => {
		await watch(page);
		await openAtlas(page);

		await pickBand(page, 5000);
		await pickBand(page, 6000);
		await expectNames(page, ['Aconcagua', 'Almost Six', 'Six Thousand']);
		await dropBand(page, 6000);
		await expectNames(page, ['Almost Six']);
	});

	test('combines the bands by OR and with country and range by AND', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'country', 'CL');
		await pickBand(page, 6000);
		await pickBand(page, 3000);
		await expectNames(page, ['Fitz Roy', 'Six Thousand']);

		await choose(page, 'country', 'AR');
		await expectNames(page, ['Aconcagua', 'Fitz Roy']);
		await expect(elevation(page)).toHaveAccessibleName('Elevation 2 elevation bands');

		await choose(page, 'range', 'andes');
		await expectNames(page, ['Aconcagua', 'Fitz Roy']);
	});

	test('offers country and range the union of the bands, and each band what they leave', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await pickBand(page, 8000);
		await pickBand(page, 6000);

		expect(await choiceLabels(page, 'country')).toEqual([
			'All countries',
			'Argentina (1)',
			'Chile (1)',
			'China (1)',
			'Nepal (1)'
		]);

		await choose(page, 'country', 'NP');
		expect(await bandLabels(page)).toEqual(['8,000–8,999 m (1)']);
	});

	test('removes only the bands a new country leaves empty, and says so', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await pickBand(page, 8000);
		await pickBand(page, 6000);
		await choose(page, 'country', 'NP');

		await expectChoice(page, 'country', 'NP');
		await expect(elevation(page)).toHaveAccessibleName('Elevation 8,000–8,999 m');
		await expectNames(page, ['Mount Everest']);
		await expect(count(page)).toContainText(
			'Elevation band 6,000–6,999 m removed: no mountains matched with your choice.'
		);
		await openElevation(page);
		await expect(bandBox(page, 6000)).toHaveCount(0);
		await expect(bandBox(page, 8000)).toBeChecked();
	});

	test('clears only the elevation bands, and Reset clears everything', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'country', 'AR');
		await pickBand(page, 6000);
		await pickBand(page, 3000);
		await expectNames(page, ['Aconcagua', 'Fitz Roy']);

		await openElevation(page);
		await expect(clearElevation(page)).toBeEnabled();
		await clearElevation(page).click();
		await expect(elevation(page)).toHaveAccessibleName('Elevation Any elevation');
		await expect(clearElevation(page)).toBeDisabled();
		// Clearing leaves the popup open and puts focus back on its first checkbox.
		await expect(popup(page).getByRole('checkbox').first()).toBeFocused();
		await closePopup(page);
		await expectChoice(page, 'country', 'AR');
		await expect(count(page)).toHaveText(`Showing 2 of ${TOTAL} mountains`);

		await pickBand(page, 6000);
		await reset(page).click();
		await expect(elevation(page)).toHaveAccessibleName('Elevation Any elevation');
		await openElevation(page);
		await expect(bandBox(page, 6000)).not.toBeChecked();
		await closePopup(page);
		await expectChoice(page, 'country', '');
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
	});

	test('is operated from the keyboard, and Escape closes the list and returns to the button', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await elevation(page).focus();
		await page.keyboard.press('Space');
		await expect(elevation(page)).toHaveAttribute('aria-expanded', 'true');

		// Focus enters the popup, on its first checkbox.
		await expect(popup(page).getByRole('checkbox').first()).toBeFocused();
		await page.keyboard.press('Space');
		await expect(popup(page).getByRole('checkbox').first()).toBeChecked();
		await expect(elevation(page)).toHaveAccessibleName('Elevation 8,000–8,999 m');
		await expectNames(page, ['Mount Everest']);

		await page.keyboard.press('Escape');
		await expect(elevation(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(elevation(page)).toBeFocused();
		await expect(elevation(page)).toHaveAccessibleName('Elevation 8,000–8,999 m');
	});
});

test.describe('@nogl Atlas filters: sorting', () => {
	test('orders the whole list by elevation, not within continents', async ({ page }) => {
		await watch(page);
		await openAtlas(page);

		await chooseSort(page, 'elevation-desc');
		await expectNames(page, [
			'Mount Everest',
			'Aconcagua',
			'Six Thousand',
			'Almost Six',
			'Mont Blanc',
			'Fitz Roy',
			'Mount Olympus',
			'Bare Peak'
		]);
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);

		await chooseSort(page, 'elevation-asc');
		await expect(matchNames(page).nth(2)).toHaveText('Fitz Roy');
		await expect(matchNames(page).first()).toHaveText('Bare Peak');
	});

	test('sorts the filtered matches, and returns to the continents on name order alone', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await choose(page, 'country', 'CL');
		await chooseSort(page, 'elevation-desc');
		await expectNames(page, ['Six Thousand', 'Almost Six', 'Fitz Roy']);

		await choose(page, 'country', '');
		await chooseSort(page, 'name');
		await expectNames(page, []);
		await expect(continent(page, 'Europe')).toBeVisible();
	});
});

test.describe('@nogl Atlas filters: reset', () => {
	test('clears filters and sort at once, restoring the continents and their memory', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await continent(page, 'Europe').click();
		await openFilters(page);
		await choose(page, 'country', 'CL');
		await chooseSort(page, 'elevation-desc');

		await reset(page).click();

		await expectChoice(page, 'country', '');
		await expectSort(page, 'name');
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
		await expect(reset(page)).toHaveCount(0);
		await expect(list(page).getByRole('link', { name: /Mont Blanc/ })).toBeVisible();
		await expect(list(page).getByRole('link', { name: /Six Thousand/ })).toBeHidden();
		await expect(filterToggle(page)).toBeFocused();
	});

	test('leaves the page with no new request for the index', async ({ page, request }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);
		const before = (await stubRequests(request)).filter((path) => path === INDEX_PATH);

		await choose(page, 'country', 'AR');
		await reset(page).click();

		expect((await stubRequests(request)).filter((path) => path === INDEX_PATH)).toEqual(before);
	});
});

test.describe('@nogl Atlas filters: searchable country and range', () => {
	const optionNames = (page: Page) =>
		popup(page)
			.getByRole('option')
			.evaluateAll((options) => options.map((o) => o.querySelector('span > span')?.textContent));

	test('searches countries ignoring case and accents, and the best match is what Enter takes', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFacet(page, 'country');

		await expect(searchField(page)).toHaveAttribute('aria-expanded', 'true');
		await searchField(page).fill('CHÍL');
		expect(await optionNames(page)).toEqual(['Chile']);
		await expect(popup(page).getByRole('status')).toHaveText('1 result');

		await searchField(page).fill('i');
		// Names that start with the letter come first, then the rest, each in order.
		expect((await optionNames(page))!.slice(0, 2)).toEqual(['Italy', 'Argentina']);
		await searchField(page).fill('chi');
		expect(await optionNames(page)).toEqual(['Chile', 'China']);

		await page.keyboard.press('Enter');
		await expectChoice(page, 'country', 'CL');
		await expectNames(page, ['Almost Six', 'Fitz Roy', 'Six Thousand']);
	});

	test('says so when nothing matches, keeps the popup open and selects nothing on Enter', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFacet(page, 'country');

		await searchField(page).fill('zzz');

		await expect(popup(page).getByRole('option')).toHaveCount(0);
		await expect(popup(page)).toContainText('No countries match \u201czzz\u201d.');
		await expect(popup(page).getByRole('status')).toContainText('No countries match');
		await page.keyboard.press('Enter');
		await expect(popup(page)).toBeVisible();
		await expectChoice(page, 'country', '');

		await searchField(page).fill('');
		await expect(popup(page).getByRole('option').first()).toHaveAccessibleName('All countries');
	});

	test('lists the options with the count on the right and marks the chosen one', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await choose(page, 'country', 'CL');
		await openFacet(page, 'country');

		await expect(popup(page).getByRole('option', { name: /^Chile/ })).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await expect(popup(page).getByRole('option', { name: /^Argentina/ })).toHaveAttribute(
			'aria-selected',
			'false'
		);
		const row = popup(page).getByRole('option', { name: /^Chile/ });
		await expect(row).toHaveAccessibleName('Chile 3 mountains');
		const [name, count] = await row.evaluate((el) => [
			el.querySelector('span > span')!.getBoundingClientRect().left,
			el.lastElementChild!.getBoundingClientRect().right
		]);
		const box = (await row.boundingBox())!;
		expect(name).toBeLessThan(box.x + box.width / 2);
		expect(count).toBeGreaterThan(box.x + box.width - 24);
		// The list opens on the chosen option, so it is the active one.
		await expect(searchField(page)).toHaveAttribute('aria-activedescendant', /.+/);
		await expect(
			popup(page).locator(`#${await searchField(page).getAttribute('aria-activedescendant')}`)
		).toHaveAccessibleName(/^Chile/);
	});

	test('shows ranges as a tree, roots first, and the names above a nested one while searching', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFacet(page, 'range');

		const depths = await popup(page)
			.getByRole('option')
			.evaluateAll((options) =>
				options.map((o) => [
					o.querySelector('span > span')?.textContent,
					(o as HTMLElement).dataset.depth
				])
			);
		expect(depths).toEqual([
			['All ranges', '0'],
			['Alps', '0'],
			['Mont Blanc massif', '1'],
			['Andes', '0'],
			['Patagonian Andes', '1'],
			['Principal Cordillera', '1'],
			['Himalaya', '0'],
			['Mahalangur', '1'],
			['Mount Olympus', '0']
		]);
		const weights = await popup(page)
			.getByRole('option')
			.evaluateAll((options) =>
				options.map((o) => getComputedStyle(o.querySelector('span > span')!).fontWeight)
			);
		// Roots carry more weight than what hangs from them.
		expect(Number(weights[1])).toBeGreaterThan(Number(weights[2]));

		await searchField(page).fill('patagonian');
		const found = popup(page).getByRole('option');
		await expect(found).toHaveCount(1);
		await expect(found).toHaveAccessibleName(/^Patagonian Andes.*Andes.*1 mountain$/);
		await expect(found).toContainText('Andes');
		await expect(found).toHaveAttribute('data-depth', '0');

		await page.keyboard.press('Enter');
		await expectNames(page, ['Fitz Roy']);
		await expect(range(page)).toHaveAccessibleName(/^Mountain range Patagonian Andes Andes$/);
	});

	test('keeps ancestor-inclusive matching: a root range takes the mountains of its subranges', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFacet(page, 'range');

		await searchField(page).fill('andes');
		expect(await optionNames(page)).toEqual(['Andes', 'Patagonian Andes']);
		await popup(page)
			.getByRole('option', { name: /^Andes\s+\d/ })
			.click();

		await expectNames(page, ['Aconcagua', 'Fitz Roy']);
		await expect(range(page)).toHaveAccessibleName(/^Mountain range Andes$/);
		// A subrange's own matches stay inside its root's.
		await choose(page, 'range', 'principal-cordillera');
		await expectNames(page, ['Aconcagua']);
	});

	test('offers only the ranges and countries the other filters leave', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await choose(page, 'country', 'GR');

		await openFacet(page, 'range');
		expect(await optionNames(page)).toEqual(['All ranges', 'Mount Olympus']);
		await searchField(page).fill('andes');
		await expect(popup(page).getByRole('option')).toHaveCount(0);
		await expect(popup(page)).toContainText('No mountain ranges match');
	});
});

test.describe('@nogl Atlas filters: popup behaviour', () => {
	test('is operated from the keyboard: arrows move, Enter chooses, focus returns to the button', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await country(page).focus();
		await page.keyboard.press('ArrowDown');
		await expect(country(page)).toHaveAttribute('aria-expanded', 'true');
		await expect(country(page)).toHaveAttribute('aria-haspopup', 'listbox');
		await expect(searchField(page)).toBeFocused();
		await expect(popup(page).getByRole('option').first()).toHaveAccessibleName('All countries');

		const active = async () =>
			popup(page).locator(`#${await searchField(page).getAttribute('aria-activedescendant')}`);
		await expect(await active()).toHaveAccessibleName('All countries');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('ArrowDown');
		await expect(await active()).toHaveAccessibleName(/^Chile/);
		await page.keyboard.press('ArrowUp');
		await expect(await active()).toHaveAccessibleName(/^Argentina/);
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		// Arrows wrap at both ends.
		await expect(await active()).toHaveAccessibleName(/^Nepal/);

		await page.keyboard.press('Enter');
		await expect(popup(page)).toHaveCount(0);
		await expect(country(page)).toBeFocused();
		await expectChoice(page, 'country', 'NP');
		await expectNames(page, ['Mount Everest']);

		// The "all" row is the way back.
		await page.keyboard.press('Enter');
		await expect(searchField(page)).toBeFocused();
		await expect(await active()).toHaveAccessibleName(/^Nepal/);
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Enter');
		await expectChoice(page, 'country', '');
		await expect(country(page)).toBeFocused();
	});

	test('closes on Escape and returns focus, leaving the choice as it was', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await choose(page, 'country', 'CL');
		await openFacet(page, 'country');
		await searchField(page).fill('ita');

		await page.keyboard.press('Escape');

		await expect(popup(page)).toHaveCount(0);
		await expect(country(page)).toBeFocused();
		await expect(country(page)).toHaveAttribute('aria-expanded', 'false');
		await expectChoice(page, 'country', 'CL');
		// The next opening starts clean.
		await openFacet(page, 'country');
		await expect(searchField(page)).toHaveValue('');
		await expect(popup(page).getByRole('option').first()).toHaveAccessibleName('All countries');
	});

	test('closes on a press outside without moving focus to the button or changing anything', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFacet(page, 'range');

		await page.getByRole('heading', { level: 1, name: 'Atlas' }).click();

		await expect(popup(page)).toHaveCount(0);
		await expect(range(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(range(page)).not.toBeFocused();
		await expectChoice(page, 'range', '');
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
	});

	test('closes when Tab moves focus on, and a second button press closes it too', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFacet(page, 'country');

		await page.keyboard.press('Tab');
		await expect(popup(page)).toHaveCount(0);

		await country(page).click();
		await expect(popup(page)).toBeVisible();
		await country(page).click();
		await expect(popup(page)).toHaveCount(0);
	});

	test('opens one popup at a time', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFacet(page, 'country');

		await page.keyboard.press('Tab');
		await expect(elevation(page)).toBeFocused();
		await page.keyboard.press('Enter');

		await expect(popup(page)).toHaveCount(1);
		await expect(page.getByRole('group', { name: 'Elevation bands' })).toBeVisible();
		await expect(country(page)).toHaveAttribute('aria-expanded', 'false');
	});

	test('stays inside the viewport and opens upward when there is no room below', async ({
		page
	}) => {
		await watch(page);
		await page.setViewportSize({ width: 390, height: 520 });
		await openAtlas(page);
		await openFilters(page);
		// Bring the range field to the bottom of the viewport.
		await range(page).evaluate((el) => {
			const gap = window.innerHeight - el.getBoundingClientRect().bottom - 16;
			window.scrollBy(0, -gap);
		});
		const trigger = (await range(page).boundingBox())!;

		await openFacet(page, 'range');

		const box = (await popup(page).boundingBox())!;
		expect(box.y + box.height).toBeLessThanOrEqual(trigger.y);
		expect(box.y).toBeGreaterThanOrEqual(0);
		expect(box.height).toBeGreaterThan(100);
		// Whatever the height, the list scrolls inside it and the page does not move.
		const before = await page.evaluate(() => window.scrollY);
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('ArrowUp');
		expect(await page.evaluate(() => window.scrollY)).toBe(before);
		expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
	});

	test('is not clipped by the atlas panel, and follows its button when the panel scrolls', async ({
		page
	}) => {
		await watch(page);
		await page.setViewportSize({ width: 1280, height: 600 });
		await openAtlas(page);
		await openFacet(page, 'range');

		const box = (await popup(page).boundingBox())!;
		const trigger = (await range(page).boundingBox())!;
		// The popup is the top element where it sits, so nothing above it clips it.
		const top = await page.evaluate(
			({ x, y }) => document.elementFromPoint(x, y)?.closest('[popover]') !== null,
			{ x: box.x + box.width / 2, y: box.y + box.height - 4 }
		);
		expect(top).toBe(true);
		expect(box.y >= trigger.y + trigger.height || box.y + box.height <= trigger.y).toBe(true);

		await page.mouse.move(box.x - 50, box.y);
		await page.mouse.wheel(0, 40);
		await expect
			.poll(async () => {
				const moved = (await popup(page).boundingBox())!;
				const button = (await range(page).boundingBox())!;

				return (
					Math.abs(moved.y - (button.y + button.height + 4)) < 1.5 ||
					Math.abs(moved.y + moved.height - (button.y - 4)) < 1.5
				);
			})
			.toBe(true);
	});

	test('names the popup parts for assistive technology', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFacet(page, 'country');

		await expect(searchField(page)).toHaveAccessibleName('Search countries');
		await expect(searchField(page)).toHaveAttribute('aria-autocomplete', 'list');
		await expect(searchField(page)).toHaveAttribute('aria-controls', /.+/);
		await expect(popup(page).getByRole('listbox')).toHaveAccessibleName('Search countries');
		await expect(country(page)).toHaveAttribute(
			'aria-controls',
			(await popup(page).getAttribute('id'))!
		);
	});

	test('keeps the results, the live count and the filters in step with what is picked', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);

		await choose(page, 'country', 'AR');
		await expect(count(page)).toHaveText(`Showing 2 of ${TOTAL} mountains`);
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 1 active');
		await choose(page, 'range', 'principal-cordillera');
		await expectNames(page, ['Aconcagua']);
		await expect(count(page)).toHaveText(`Showing 1 of ${TOTAL} mountains`);
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 2 active');
	});
});

test.describe('@nogl Atlas filters: sort menu', () => {
	test('offers the three orders, marks the current one and sorts by the one picked', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await expectSort(page, 'name');

		await sort(page).click();
		const options = popup(page).getByRole('option');
		await expect(options).toHaveText(['Name A–Z', 'Highest first', 'Lowest first']);
		await expect(popup(page).getByRole('listbox')).toHaveAccessibleName('Sort');
		await expect(popup(page).getByRole('searchbox')).toHaveCount(0);
		await expect(options.nth(0)).toHaveAttribute('aria-selected', 'true');
		await expect(options.nth(1)).toHaveAttribute('aria-selected', 'false');

		await options.nth(2).click();

		await expect(popup(page)).toHaveCount(0);
		await expect(sort(page)).toBeFocused();
		await expectSort(page, 'elevation-asc');
		await expectNames(page, [
			'Bare Peak',
			'Mount Olympus',
			'Fitz Roy',
			'Mont Blanc',
			'Almost Six',
			'Six Thousand',
			'Aconcagua',
			'Mount Everest'
		]);

		await sort(page).click();
		await expect(popup(page).getByRole('option', { name: 'Lowest first' })).toHaveAttribute(
			'aria-selected',
			'true'
		);
	});

	test('is operated from the keyboard, and Escape or a press outside leave the order as it was', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);

		await sort(page).focus();
		await page.keyboard.press('ArrowDown');
		const listbox = popup(page).getByRole('listbox');
		await expect(listbox).toBeFocused();
		const active = async () =>
			popup(page).locator(`#${await listbox.getAttribute('aria-activedescendant')}`);
		await expect(await active()).toHaveText('Name A–Z');
		await page.keyboard.press('ArrowUp');
		await expect(await active()).toHaveText('Lowest first');
		await page.keyboard.press('Home');
		await expect(await active()).toHaveText('Name A–Z');
		await page.keyboard.press('End');
		await expect(await active()).toHaveText('Lowest first');
		await page.keyboard.press('ArrowUp');
		await page.keyboard.press('Enter');

		await expect(popup(page)).toHaveCount(0);
		await expect(sort(page)).toBeFocused();
		await expectSort(page, 'elevation-desc');

		await page.keyboard.press('Enter');
		await expect(await active()).toHaveText('Highest first');
		await page.keyboard.press('ArrowDown');
		await page.keyboard.press('Escape');
		await expect(popup(page)).toHaveCount(0);
		await expect(sort(page)).toBeFocused();
		await expectSort(page, 'elevation-desc');

		await sort(page).click();
		await page.getByRole('heading', { level: 1, name: 'Atlas' }).click();
		await expect(popup(page)).toHaveCount(0);
		await expect(sort(page)).toHaveAttribute('aria-expanded', 'false');
		await expectSort(page, 'elevation-desc');

		await sort(page).click();
		await page.keyboard.press('Space');
		await expectSort(page, 'elevation-desc');
		await sort(page).click();
		await page.keyboard.press('Tab');
		await expect(popup(page)).toHaveCount(0);
	});

	test('looks like the other triggers and popups, and fits the viewport on a phone', async ({
		page
	}) => {
		await watch(page);
		await page.setViewportSize({ width: 390, height: 740 });
		await openAtlas(page);
		await openFilters(page);

		const box = async (locator: ReturnType<typeof sort>) => (await locator.boundingBox())!;
		expect((await box(sort(page))).height).toBe((await box(filterToggle(page))).height);
		expect((await box(sort(page))).height).toBe((await box(country(page))).height);

		const style = (locator: ReturnType<typeof sort>) =>
			locator.evaluate((el) => {
				const css = getComputedStyle(el);

				return [css.fontSize, css.paddingRight, css.borderRadius, css.borderTopColor];
			});
		expect(await style(sort(page))).toEqual(await style(country(page)));

		await sort(page).click();
		const popupBox = (await popup(page).boundingBox())!;
		const trigger = await box(sort(page));
		expect(popupBox.x).toBeGreaterThanOrEqual(0);
		expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(390);
		expect(popupBox.width).toBeCloseTo(trigger.width, 0);
		expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		for (const option of await popup(page).getByRole('option').all()) {
			expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(40);
		}
		expect(
			await popup(page).evaluate((el) => {
				const css = getComputedStyle(el);

				return [css.borderRadius, css.backgroundColor];
			})
		).toEqual(
			await (async () => {
				await closePopup(page);
				await openFacet(page, 'country');

				return popup(page).evaluate((el) => {
					const css = getComputedStyle(el);

					return [css.borderRadius, css.backgroundColor];
				});
			})()
		);
	});
});

test.describe('@nogl Atlas filters: keyboard', () => {
	test('opens the filters, chooses with the keyboard, and resets from the keyboard', async ({
		page
	}) => {
		await watch(page);
		await openAtlas(page);

		await filterToggle(page).focus();
		await page.keyboard.press('Enter');
		await expect(filterToggle(page)).toHaveAttribute('aria-expanded', 'true');
		await page.keyboard.press('Tab');
		await expect(sort(page)).toBeFocused();
		await page.keyboard.press('Tab');
		await expect(country(page)).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(searchField(page)).toBeFocused();
		await page.keyboard.type('chil');
		await page.keyboard.press('Enter');
		await expect(popup(page)).toHaveCount(0);
		await expect(country(page)).toBeFocused();
		await expectChoice(page, 'country', 'CL');
		await expectNames(page, ['Almost Six', 'Fitz Roy', 'Six Thousand']);

		await reset(page).focus();
		await page.keyboard.press('Space');
		await expectChoice(page, 'country', '');
		await expect(filterToggle(page)).toBeFocused();
		await page.keyboard.press('Space');
		await expect(filterToggle(page)).toHaveAttribute('aria-expanded', 'false');
	});

	test('reaches the matching mountains by Tab and opens one with Enter', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);
		await choose(page, 'country', 'AR');

		await list(page).getByRole('link').first().focus();
		await page.keyboard.press('Enter');

		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
	});
});

test.describe('@nogl Atlas filters: navigation', () => {
	test('keeps the view through Atlas, Mountain and the Back to atlas link', async ({ page }) => {
		const watched = await watch(page);
		await openAtlas(page);
		await openFilters(page);
		await choose(page, 'country', 'AR');
		await chooseSort(page, 'elevation-asc');
		const documentsBefore = watched.documents.length;

		await list(page)
			.getByRole('link', { name: /Aconcagua/ })
			.click();
		await expect(page.getByRole('heading', { level: 1, name: ACONCAGUA.name })).toBeVisible();
		await backToAtlas(page).click();

		await expect(page).toHaveURL(/\/atlas$/);
		await expectNames(page, ['Fitz Roy', 'Aconcagua']);
		await expect(filterToggle(page)).toHaveAccessibleName('Filter, 1 active');
		await openFilters(page);
		await expectChoice(page, 'country', 'AR');
		await expectSort(page, 'elevation-asc');
		await expect(count(page)).toHaveText(`Showing 2 of ${TOTAL} mountains`);
		expect(watched.documents.length).toBe(documentsBefore);
		expect(watched.pageErrors).toEqual([]);
	});

	test('keeps the view through the browser Back button and Forward again', async ({ page }) => {
		const watched = await watch(page);
		await openAtlas(page);
		await openFilters(page);
		await choose(page, 'range', 'andes');

		await list(page)
			.getByRole('link', { name: /Aconcagua/ })
			.click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await page.goBack();

		await expect(page).toHaveURL(/\/atlas$/);
		await expectNames(page, ['Aconcagua', 'Fitz Roy']);

		await page.goForward();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		expect(watched.pageErrors).toEqual([]);
	});

	test('does not touch the address or browser storage', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);
		await choose(page, 'country', 'AR');
		await chooseSort(page, 'elevation-desc');

		expect(new URL(page.url()).search).toBe('');
		expect(new URL(page.url()).hash).toBe('');
		expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0);
	});

	test('keeps the whole index for search while the list is filtered', async ({ page }) => {
		await watch(page);
		await openAtlas(page);
		await openFilters(page);
		await choose(page, 'country', 'NP');

		await page.getByRole('button', { name: 'Search mountains' }).click();
		const dialog = page.getByRole('dialog', { name: 'Search mountains' });
		await expect(dialog.getByRole('status')).toHaveText(`Type to search ${TOTAL} mountains.`);
	});
});

test.describe('@nogl Atlas filters: layout', () => {
	for (const width of [320, 375, 430]) {
		test(`fits ${width} px with comfortable targets and no horizontal scroll`, async ({ page }) => {
			await watch(page);
			await page.setViewportSize({ width, height: 740 });
			await openAtlas(page);
			await openFilters(page);
			await choose(page, 'range', 'principal-cordillera');

			for (const control of [
				filterToggle(page),
				sort(page),
				country(page),
				elevation(page),
				range(page),
				reset(page)
			]) {
				const box = await control.boundingBox();
				expect(box!.height).toBeGreaterThanOrEqual(44);
				expect(box!.x).toBeGreaterThanOrEqual(0);
				expect(box!.x + box!.width).toBeLessThanOrEqual(width);
			}
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);

			// Each popup opens inside the viewport, however narrow, and adds no horizontal scroll.
			for (const open of [
				() => openFacet(page, 'country'),
				() => openElevation(page),
				() => openFacet(page, 'range')
			]) {
				await open();
				const box = (await popup(page).boundingBox())!;
				expect(box.x).toBeGreaterThanOrEqual(0);
				expect(box.x + box.width).toBeLessThanOrEqual(width);
				expect(box.y).toBeGreaterThanOrEqual(0);
				expect(box.y + box.height).toBeLessThanOrEqual(740);
				expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
				await closePopup(page);
			}

			await chooseSort(page, 'elevation-desc');
			await choose(page, 'country', '');
			await choose(page, 'range', '');
			expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
		});
	}

	test('fits the narrow editorial panel on a desktop', async ({ page }) => {
		await watch(page);
		await page.setViewportSize({ width: 1280, height: 800 });
		await openAtlas(page);
		await openFilters(page);

		const panel = (await list(page).boundingBox())!;
		const stage = (await page.locator('[data-stage]').boundingBox())!;
		expect(panel.x).toBeGreaterThanOrEqual(stage.x + stage.width - 1);
		for (const control of [
			filterToggle(page),
			sort(page),
			country(page),
			elevation(page),
			range(page)
		]) {
			const box = (await control.boundingBox())!;
			expect(box.x).toBeGreaterThanOrEqual(panel.x - 1);
			expect(box.x + box.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
		}
		expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
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

		await filterToggle(page).tap();
		await expect(country(page)).toBeVisible();

		await country(page).tap();
		await expect(searchField(page)).toBeFocused();
		// Touch gets full-size rows.
		for (const option of await popup(page).getByRole('option').all()) {
			expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
		await popup(page)
			.getByRole('option', { name: /^Nepal/ })
			.tap();
		await expect(popup(page)).toHaveCount(0);
		await expectNames(page, ['Mount Everest']);

		await elevation(page).tap();
		await expect(popup(page).getByRole('checkbox').first()).toBeVisible();
		for (const row of await popup(page).locator('label').all()) {
			expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
		}
		await popup(page).getByRole('checkbox').first().tap();
		await expect(elevation(page)).toHaveAccessibleName('Elevation 8,000–8,999 m');
		// A tap outside, on the page, closes the popup.
		await page.getByRole('heading', { level: 1, name: 'Atlas' }).tap();
		await expect(popup(page)).toHaveCount(0);

		await reset(page).tap();
		await expect(count(page)).toHaveText(`Showing all ${TOTAL} mountains`);
		await context.close();
	});
});

test.describe('@nogl Atlas filters: without script', () => {
	test('leaves the document as it was: continents, links, and no controls that could not work', async ({
		browser
	}) => {
		const context = await browser.newContext({ javaScriptEnabled: false });
		const page = await context.newPage();

		await page.goto('/atlas');

		await expect(page.locator('select')).toHaveCount(0);
		await expect(page.locator('[aria-live]')).toHaveCount(0);
		await expect(list(page).getByRole('button')).toHaveCount(0);
		await continent(page, 'South America').click();
		await list(page)
			.getByRole('link', { name: /Aconcagua/ })
			.click();
		await expect(page).toHaveURL(new RegExp(`/mountains/${ACONCAGUA.slug}$`));
		await context.close();
	});
});
