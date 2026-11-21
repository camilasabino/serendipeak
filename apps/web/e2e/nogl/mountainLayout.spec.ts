import { expect, test, type Page } from '@playwright/test';
import { fixture, resetStub } from '../ssr/support';

const ACONCAGUA = fixture<{ slug: string; name: string }>('mountain-complete.json');
const PATH = `/mountains/${ACONCAGUA.slug}`;

const REM = 16;
const stage = (page: Page) => page.locator('[data-stage]');
const heading = (page: Page) => page.getByRole('heading', { level: 1, name: ACONCAGUA.name });
const share = (page: Page) => page.getByRole('group', { name: 'Share' });
const explore = (page: Page) => page.getByRole('button', { name: /^Explore another/ });

async function box(locator: ReturnType<Page['locator']>) {
	const found = await locator.boundingBox();
	expect(found).not.toBeNull();
	return found!;
}

test.beforeEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@nogl mountain page layout', () => {
	for (const [width, height] of [
		[390, 844],
		[375, 667],
		[320, 640],
		[412, 915],
		[320, 568],
		[768, 1024],
		[844, 390]
	] as const) {
		test(`reads name, stage, running head, Explore at ${width}×${height}`, async ({ page }) => {
			await page.setViewportSize({ width, height });
			await page.goto(PATH);

			const [name, stageBox, shareBox, exploreBox] = await Promise.all([
				box(heading(page)),
				box(stage(page)),
				box(share(page)),
				box(explore(page))
			]);
			const header = await box(page.getByRole('banner'));
			const expectedStage =
				height > width
					? Math.min(Math.max(height - 17 * REM, 18 * REM), 46 * REM)
					: Math.min(Math.max(height * 0.38, 14 * REM), 22 * REM);

			expect(name.y).toBeGreaterThanOrEqual(header.y + header.height);
			expect(name.y + name.height).toBeLessThanOrEqual(stageBox.y);
			expect(stageBox.height).toBeCloseTo(expectedStage, 0);
			expect(stageBox.width).toBe(width);
			expect(shareBox.y).toBeGreaterThanOrEqual(stageBox.y + stageBox.height);
			expect(exploreBox.y).toBeGreaterThan(shareBox.y + shareBox.height);
			expect(
				await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)
			).toBeLessThanOrEqual(0);
			await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
		});
	}

	test('keeps the stage beside the sheet, with the name inside the sheet, on desktop', async ({
		page
	}) => {
		await page.setViewportSize({ width: 1440, height: 900 });
		await page.goto(PATH);

		const [name, stageBox] = await Promise.all([box(heading(page)), box(stage(page))]);

		expect(name.x).toBeGreaterThanOrEqual(stageBox.x + stageBox.width);
		expect(stageBox.height).toBeGreaterThan(600);
	});
});
