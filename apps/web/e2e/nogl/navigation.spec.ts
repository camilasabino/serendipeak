import { expect, test, type Locator, type Page } from '@playwright/test';
import { fixture, resetStub } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const ACONCAGUA = fixture<Named>('mountain-complete.json');
const DAILY = fixture<{ mountain: Named }>('daily-mountain.json').mountain;

const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 1024, 1440];
const PAGES = ['/', `/mountains/${ACONCAGUA.slug}`, '/atlas', '/about'];
const SPLIT_LAYOUT_MIN_WIDTH = 896;

const primary = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const brand = (page: Page) => page.getByRole('banner').getByRole('link', { name: 'SerendiPeak' });
const exploreButtons = (page: Page) => page.getByRole('button', { name: /^Explore another/ });

async function boxes(locators: Locator[]) {
	const result = [];
	for (const locator of locators) {
		const box = await locator.boundingBox();
		expect(box).not.toBeNull();
		result.push(box!);
	}
	return result;
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl global navigation', () => {
	test('reaches every primary destination from every public page', async ({ page }) => {
		for (const path of PAGES) {
			await page.goto(path);

			await expect(primary(page).getByRole('link', { name: 'Today' })).toHaveAttribute('href', '/');
			await expect(primary(page).getByRole('link', { name: 'Atlas' })).toHaveAttribute(
				'href',
				'/atlas'
			);
			await expect(primary(page).getByRole('link', { name: 'About' })).toHaveAttribute(
				'href',
				'/about'
			);
			await expect(primary(page).getByRole('button', { name: 'Search mountains' })).toBeVisible();
		}
	});

	test('keeps Today off a permalink and marks it on the home route', async ({ page }) => {
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await expect(primary(page).locator('[aria-current="page"]')).toHaveCount(0);

		await primary(page).getByRole('link', { name: 'Today' }).click();

		await expect(page.getByRole('heading', { level: 1 })).toHaveText(DAILY.name);
		await expect(primary(page).getByRole('link', { name: 'Today' })).toHaveAttribute(
			'aria-current',
			'page'
		);
	});

	test('moves between Today, Atlas and About by keyboard', async ({ page }) => {
		await page.goto('/');

		await primary(page).getByRole('link', { name: 'Atlas' }).focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/atlas$/);
		await expect(primary(page).getByRole('link', { name: 'Atlas' })).toHaveAttribute(
			'aria-current',
			'page'
		);

		await primary(page).getByRole('link', { name: 'Today' }).focus();
		await page.keyboard.press('Enter');
		await expect(page).toHaveURL(/\/$/);
	});

	test('keeps the contextual actions on a mountain page', async ({ page }) => {
		await page.goto(`/mountains/${ACONCAGUA.slug}`);

		await expect(page.getByRole('link', { name: 'Back to atlas' })).toHaveAttribute(
			'href',
			'/atlas'
		);
		await expect(exploreButtons(page)).toHaveCount(1);
	});

	test('still opens search from the header', async ({ page }) => {
		await page.goto('/about');

		await primary(page).getByRole('button', { name: 'Search mountains' }).click();

		await expect(page.getByRole('dialog', { name: 'Search mountains' })).toBeVisible();
	});

	for (const width of WIDTHS) {
		test(`lays the header out without overlap or overflow at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });

			for (const path of PAGES) {
				await page.goto(path);
				await expect(primary(page)).toBeVisible();

				const controls = [
					brand(page),
					primary(page).getByRole('button', { name: 'Search mountains' }),
					primary(page).getByRole('link', { name: 'Today' }),
					primary(page).getByRole('link', { name: 'Atlas' }),
					primary(page).getByRole('link', { name: 'About' })
				];
				const placed = await boxes(controls);

				for (const box of placed) {
					expect(box.height, `${path} target height`).toBeGreaterThanOrEqual(44);
					expect(box.x, `${path} left edge`).toBeGreaterThanOrEqual(0);
					expect(box.x + box.width, `${path} right edge`).toBeLessThanOrEqual(width);
				}
				for (const [index, box] of placed.entries()) {
					const next = placed[index + 1];
					if (next) {
						expect(box.x + box.width, `${path} control ${index} overlaps`).toBeLessThanOrEqual(
							next.x + 0.5
						);
					}
				}
				for (const box of placed.slice(2)) {
					expect(box.width, `${path} link width`).toBeGreaterThanOrEqual(44);
				}

				const wordmark = await brand(page)
					.locator('span')
					.evaluate((element) => element.getBoundingClientRect().width > 1);
				expect(wordmark, `${path} wordmark`).toBe(width > 384);

				const overflow = await page.evaluate(
					() => document.documentElement.scrollWidth - document.documentElement.clientWidth
				);
				expect(overflow, `${path} horizontal overflow`).toBeLessThanOrEqual(0);
			}
		});

		test(`offers one visible Explore control on a mountain at ${width}px`, async ({ page }) => {
			await page.setViewportSize({ width, height: 800 });
			await page.goto(`/mountains/${ACONCAGUA.slug}`);

			await expect(exploreButtons(page)).toHaveCount(1);
			const inHeader =
				(await page
					.getByRole('banner')
					.getByRole('button', {
						name: /^Explore another/
					})
					.count()) === 1;
			expect(inHeader).toBe(width >= SPLIT_LAYOUT_MIN_WIDTH);
		});
	}
});
