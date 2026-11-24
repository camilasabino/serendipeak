import { expect, test, type Page } from '@playwright/test';
import { fixture, resetStub } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');

// The atlas's own filter bar is wider than a narrow, enlarged-text screen; that is the atlas's to fix.
const ATLAS_PATH = '/atlas';

const primary = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const menuButton = (page: Page) => primary(page).getByRole('button', { name: 'Menu' });
const searchButton = (page: Page) =>
	primary(page).getByRole('button', { name: 'Search mountains' });
const link = (page: Page, name: string) => primary(page).getByRole('link', { name });
const units = (page: Page) => primary(page).getByRole('group', { name: 'Units' });
const metric = (page: Page) => units(page).getByRole('button', { name: 'Metric, meters' });
const imperial = (page: Page) => units(page).getByRole('button', { name: 'Imperial, feet' });

const overflowOf = (page: Page) =>
	page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const headerOverflowOf = (page: Page) =>
	page.evaluate(() => {
		const header = document.querySelector('header')!;
		return header.scrollWidth - header.clientWidth;
	});

// Enlarged browser text moves the root font size, which is what the header's rem widths follow.
async function enlargeText(page: Page, pixels: number) {
	await page.addStyleTag({ content: `html { font-size: ${pixels}px; }` });
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl Header menu on a narrow header', () => {
	test.beforeEach(async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 640 });
		await page.goto('/about');
	});

	test('keeps search and the menu button in the row and the rest out of reach until opened', async ({
		page
	}) => {
		await expect(searchButton(page)).toBeVisible();
		await expect(menuButton(page)).toBeVisible();
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(link(page, 'Atlas')).toBeHidden();
		await expect(units(page)).toBeHidden();
	});

	test('opens the links and the unit selector, marks the current page and reports the state', async ({
		page
	}) => {
		await menuButton(page).click();

		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
		const controlled = await menuButton(page).getAttribute('aria-controls');
		await expect(page.locator(`[id="${controlled}"]`)).toContainText('About');
		for (const name of ['Today', 'Atlas', 'About']) {
			await expect(link(page, name)).toBeVisible();
			expect((await link(page, name).boundingBox())?.height).toBeGreaterThanOrEqual(44);
		}
		await expect(link(page, 'About')).toHaveAttribute('aria-current', 'page');
		await expect(units(page)).toBeVisible();
		expect(await overflowOf(page)).toBe(0);
	});

	test('takes Tab through the button, the links and the unit buttons in order', async ({
		page
	}) => {
		await searchButton(page).focus();
		await page.keyboard.press('Tab');
		await expect(menuButton(page)).toBeFocused();

		await page.keyboard.press('Enter');
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');
		for (const target of [
			link(page, 'Today'),
			link(page, 'Atlas'),
			link(page, 'About'),
			metric(page),
			imperial(page)
		]) {
			await page.keyboard.press('Tab');
			await expect(target).toBeFocused();
		}
	});

	test('closes on Escape and returns focus to the button', async ({ page }) => {
		await menuButton(page).click();
		await link(page, 'Atlas').focus();

		await page.keyboard.press('Escape');

		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(menuButton(page)).toBeFocused();
		await expect(link(page, 'Atlas')).toBeHidden();
	});

	test('closes on a click outside, and when focus moves out of it', async ({ page }) => {
		await menuButton(page).click();
		// Below the panel, which covers the top of the page while it is open.
		await page.mouse.click(160, 620);
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');

		await menuButton(page).click();
		await page.keyboard.press('Shift+Tab');
		await expect(searchButton(page)).toBeFocused();
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
	});

	test('toggles from the button and closes when search opens', async ({ page }) => {
		await menuButton(page).click();
		await menuButton(page).click();
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');

		await menuButton(page).click();
		await searchButton(page).click();

		await expect(page.getByRole('dialog', { name: 'Search mountains' })).toBeVisible();
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
	});

	test('navigates from a link, closes, and leaves focus on the button', async ({ page }) => {
		await menuButton(page).click();

		await link(page, 'Atlas').click();

		await expect(page).toHaveURL(/\/atlas$/);
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
		await menuButton(page).click();
		await expect(link(page, 'Atlas')).toHaveAttribute('aria-current', 'page');
	});

	test('changes and keeps the unit preference from inside the menu', async ({ page }) => {
		await menuButton(page).click();
		await expect(metric(page)).toHaveAttribute('aria-pressed', 'true');

		await imperial(page).click();

		await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'true');

		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await menuButton(page).click();
		await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');
	});

	test('does not stay open across a widening and a narrowing of the header', async ({ page }) => {
		await menuButton(page).click();

		await page.setViewportSize({ width: 800, height: 640 });
		await expect(link(page, 'Atlas')).toBeVisible();
		await expect(menuButton(page)).toBeHidden();

		await page.setViewportSize({ width: 320, height: 640 });
		await expect(menuButton(page)).toBeVisible();
		await expect(menuButton(page)).toHaveAttribute('aria-expanded', 'false');
		await expect(link(page, 'Atlas')).toBeHidden();
	});
});

test.describe('@nogl Header menu with touch', () => {
	test.use({ hasTouch: true });

	test('opens and navigates by tap with 44 px targets', async ({ page }) => {
		await page.setViewportSize({ width: 320, height: 640 });
		await page.goto('/about');

		const button = await menuButton(page).boundingBox();
		expect(button?.width).toBeGreaterThanOrEqual(44);
		expect(button?.height).toBeGreaterThanOrEqual(44);

		await menuButton(page).tap();
		await link(page, 'Atlas').tap();

		await expect(page).toHaveURL(/\/atlas$/);
	});
});

test.describe('@nogl Header with enlarged text', () => {
	for (const [width, text] of [
		[320, 20],
		[320, 24],
		[360, 24],
		[390, 24]
	] as const) {
		test(`has no overflow and keeps every function at ${width} px with ${text} px text`, async ({
			page
		}) => {
			await page.setViewportSize({ width, height: 700 });

			for (const path of ['/', `/mountains/${ACONCAGUA.slug}`, ATLAS_PATH, '/about']) {
				await page.goto(path);
				await enlargeText(page, text);

				await expect(menuButton(page), path).toBeVisible();
				expect(await headerOverflowOf(page), `${path} header overflow`).toBe(0);
				if (path !== ATLAS_PATH) {
					expect(await overflowOf(page), `${path} overflow`).toBe(0);
				}
				const brand = await page
					.getByRole('banner')
					.getByRole('link', { name: 'SerendiPeak home' })
					.boundingBox();
				expect(brand?.width, `${path} brand`).toBeGreaterThan(40);

				await menuButton(page).click();
				for (const name of ['Today', 'Atlas', 'About']) {
					const box = await link(page, name).boundingBox();
					expect(box?.x, `${path} ${name}`).toBeGreaterThanOrEqual(0);
					expect((box?.x ?? 0) + (box?.width ?? 0), `${path} ${name}`).toBeLessThanOrEqual(width);
				}
				await expect(units(page)).toBeVisible();
				expect(await headerOverflowOf(page), `${path} open header overflow`).toBe(0);
				if (path !== ATLAS_PATH) {
					expect(await overflowOf(page), `${path} open overflow`).toBe(0);
				}
				await page.keyboard.press('Escape');
			}
		});
	}

	test('puts the links back in the row once the header has the room for them', async ({ page }) => {
		await page.setViewportSize({ width: 960, height: 700 });
		await page.goto('/about');
		await enlargeText(page, 24);

		await expect(menuButton(page)).toBeHidden();
		await expect(link(page, 'Atlas')).toBeVisible();
		await expect(units(page)).toBeVisible();
		expect(await overflowOf(page)).toBe(0);
	});
});
