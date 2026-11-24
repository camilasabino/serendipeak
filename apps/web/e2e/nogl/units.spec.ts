import { expect, test, type Page } from '@playwright/test';
import { fixture, resetStub } from '../ssr/support';

interface Named {
	slug: string;
	name: string;
}

const OLYMPUS = fixture<Named>('mountain-sparse.json');

const units = (page: Page) => page.getByRole('group', { name: 'Units' });
const metric = (page: Page) => units(page).getByRole('button', { name: 'Metric, meters' });
const imperial = (page: Page) => units(page).getByRole('button', { name: 'Imperial, feet' });
const heading = (page: Page) => page.getByRole('heading', { level: 1 });

async function searchFor(page: Page, query: string) {
	await page
		.getByRole('navigation', { name: 'Primary' })
		.getByRole('button', { name: 'Search mountains' })
		.click();
	await page.getByRole('combobox', { name: 'Mountain name' }).fill(query);
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl Unit system', () => {
	test('starts metric, switches search, permalink and atlas to feet, and keeps the choice', async ({
		page
	}) => {
		const pageErrors: string[] = [];
		page.on('pageerror', (error) => pageErrors.push(error.message));

		await page.goto('/');
		await expect(metric(page)).toHaveAttribute('aria-pressed', 'true');
		await expect(imperial(page)).toHaveAttribute('aria-pressed', 'false');

		await imperial(page).click();
		await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');

		await searchFor(page, 'olymp');
		await expect(page.getByRole('option', { name: /Mount Olympus/ })).toContainText('9,573 ft');
		await page.getByRole('option', { name: /Mount Olympus/ }).click();

		await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
		await expect(heading(page)).toHaveText(OLYMPUS.name);
		await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByText('9,573', { exact: true })).toBeVisible();

		await page.reload();
		await expect(heading(page)).toHaveText(OLYMPUS.name);
		await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');
		await expect(page.getByText('9,573', { exact: true })).toBeVisible();

		await page.getByRole('link', { name: 'Atlas' }).first().click();
		await page.getByText('Europe').first().click();
		await expect(page.getByRole('link', { name: /Mount Olympus/ })).toContainText('9,573 ft');

		await metric(page).click();
		await expect(page.getByRole('link', { name: /Mount Olympus/ })).toContainText('2,918 m');
		expect(pageErrors).toEqual([]);
	});

	test('is operable from the keyboard', async ({ page }) => {
		await page.goto('/about');
		await imperial(page).focus();
		await expect(imperial(page)).toBeFocused();
		await page.keyboard.press('Enter');

		await expect(imperial(page)).toHaveAttribute('aria-pressed', 'true');
	});
});
