import type { Page } from '@playwright/test';

export const list = (page: Page) => page.getByRole('region', { name: 'Atlas mountains' });
export const popup = (page: Page) => page.locator('[popover]');

export async function openFilters(page: Page) {
	const country = list(page).getByRole('button', { name: /^Country/ });
	if (!(await country.isVisible())) {
		await list(page)
			.getByRole('button', { name: /^Filter/ })
			.click();
	}
}

export async function chooseCountry(page: Page, name: string) {
	await openFilters(page);
	await list(page)
		.getByRole('button', { name: /^Country/ })
		.click();
	await popup(page)
		.getByRole('option', { name: new RegExp(`^${name}\\s+\\d`) })
		.click();
}
