import type { Page } from '@playwright/test';
import { SUMMIT_MARKER_STYLE } from '../../src/stage/globe/marker';
import { ACONCAGUA, DESKTOP, dragGlobe, expect, expectReadyStage, test } from './support/stage';

interface SummitDrawing {
	disc: { x: number; y: number };
	pill: { left: number; right: number; bottom: number } | undefined;
}

/**
 * Finds the summit on the stage by what it is made of, since the canvas holds no DOM to ask: the
 * disc is the only solid copper block, and the pill is the run of basalt just above it.
 */
async function readSummit(page: Page): Promise<SummitDrawing | undefined> {
	const stage = (await page.locator('canvas').first().boundingBox())!;
	const shot = (await page.screenshot({ clip: stage })).toString('base64');

	return page.evaluate(
		async ({ png, colors }) => {
			const image = new Image();
			image.src = `data:image/png;base64,${png}`;
			await image.decode();
			const bitmap = await createImageBitmap(image);
			const surface = new OffscreenCanvas(bitmap.width, bitmap.height).getContext('2d')!;
			surface.drawImage(bitmap, 0, 0);
			const { data, width, height } = surface.getImageData(0, 0, bitmap.width, bitmap.height);
			const near = (x: number, y: number, hex: string, tolerance: number) => {
				const at = (y * width + x) * 4;
				const value = Number.parseInt(hex.slice(1), 16);
				return (
					Math.abs(data[at]! - (value >> 16)) <= tolerance &&
					Math.abs(data[at + 1]! - ((value >> 8) & 255)) <= tolerance &&
					Math.abs(data[at + 2]! - (value & 255)) <= tolerance
				);
			};
			const solid = (x: number, y: number) => {
				for (let dy = -2; dy <= 2; dy += 1) {
					for (let dx = -2; dx <= 2; dx += 1) {
						if (!near(x + dx, y + dy, colors.copper, 10)) return false;
					}
				}
				return true;
			};

			let disc: { x: number; y: number } | undefined;
			for (let y = 3; y < height - 3 && !disc; y += 1) {
				for (let x = 3; x < width - 3; x += 1) {
					if (solid(x, y)) {
						disc = { x, y };
						break;
					}
				}
			}
			if (!disc) return undefined;

			// Below the text, inside the pill's lower padding, so the run of basalt is not broken by letters.
			const row = disc.y - 16;
			let left = disc.x;
			let right = disc.x;
			while (left > 0 && near(left - 1, row, colors.basalt, 6)) left -= 1;
			while (right < width - 1 && near(right + 1, row, colors.basalt, 6)) right += 1;
			if (right - left < 40) return { disc, pill: undefined };

			let bottom = row;
			while (bottom < height - 1 && near(disc.x - 30, bottom + 1, colors.basalt, 6)) bottom += 1;

			return { disc, pill: { left, right, bottom } };
		},
		{ png: shot, colors: SUMMIT_MARKER_STYLE.colors }
	);
}

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
