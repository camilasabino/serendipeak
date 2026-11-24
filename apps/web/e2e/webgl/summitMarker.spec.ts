import type { Page } from '@playwright/test';
import { SUMMIT_MARKER_STYLE } from '../../src/stage/globe/marker';
import { ACONCAGUA, DESKTOP, dragGlobe, expect, expectReadyStage, test } from './support/stage';
import { readSummit, type SummitDrawing } from './support/summit';

async function expectPillAboveDisc(page: Page): Promise<{ width: number }> {
	let reading: SummitDrawing | undefined;
	await expect
		.poll(
			async () => {
				reading = await readSummit(page);
				return reading?.pill !== undefined;
			},
			{ message: 'the pill is drawn above the disc' }
		)
		.toBe(true);

	const { disc, pill } = reading!;
	expect(pill!.left).toBeLessThan(disc.x);
	expect(pill!.right).toBeGreaterThan(disc.x);
	// The pill's bottom edge stands off the summit by the label offset; the disc's centre is the summit.
	const gap = disc.y - pill!.bottom;
	expect(gap).toBeGreaterThanOrEqual(SUMMIT_MARKER_STYLE.labelOffsetPixels - 3);
	expect(gap).toBeLessThanOrEqual(SUMMIT_MARKER_STYLE.labelOffsetPixels + 3);

	return { width: pill!.right - pill!.left };
}

test.describe('@webgl summit marker', () => {
	test('leaves the disc alone on the phone layout, brings the pill back on desktop and keeps both with the summit', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await expectReadyStage(page);

		await expect.poll(async () => (await readSummit(page))?.disc !== undefined).toBe(true);
		await expect.poll(async () => (await readSummit(page))?.pill).toBeUndefined();

		await page.setViewportSize(DESKTOP);
		await expectPillAboveDisc(page);

		await test.step('the pill follows the summit through a drag', async () => {
			const before = (await readSummit(page))!.disc;
			await dragGlobe(page, 0.12, 0.05);
			await expect
				.poll(async () => {
					const now = (await readSummit(page))?.disc;
					return now !== undefined && (now.x !== before.x || now.y !== before.y);
				})
				.toBe(true);
			await expectPillAboveDisc(page);
		});

		await page.setViewportSize({ width: 390, height: 844 });
		await expect.poll(async () => (await readSummit(page))?.pill).toBeUndefined();
		expect((await readSummit(page))?.disc).toBeDefined();
	});
});
