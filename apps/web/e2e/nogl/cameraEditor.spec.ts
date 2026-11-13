import { expect, test } from '@playwright/test';

test.describe('@nogl camera editor link', () => {
	test('refuses an invalid link without starting a globe', async ({ page }) => {
		await page.goto('/editorial/camera?mountain=not-a-uuid');

		await expect(page.locator('main [role="alert"]')).toContainText('Open the camera editor again');
		await expect(page.locator('canvas')).toHaveCount(0);
		await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
	});
});
