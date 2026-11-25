import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import { list } from './support/atlasList';
import { readSummit } from './support/summit';
import {
	ACONCAGUA,
	DESKTOP,
	OLYMPUS,
	atlasLayer,
	cameraAtRest,
	cameraReading,
	expect,
	expectReadyStage,
	framesPass,
	liveViewers,
	test
} from './support/stage';

const hide = (page: Page) => page.getByRole('button', { name: 'Hide mountain markers' });
const show = (page: Page) => page.getByRole('button', { name: 'Show mountain markers' });
const canvas = (page: Page) => page.locator('main canvas');
const primary = (page: Page) => page.getByRole('navigation', { name: 'Primary' });
const stage = (page: Page) => page.locator('main [data-stage]');

const summitDrawn = async (page: Page) => (await readSummit(page))?.disc !== undefined;
const pillDrawn = async (page: Page) => (await readSummit(page))?.pill !== undefined;

async function probeViewer(page: Page) {
	await page.waitForFunction(() => 'next' in window);
	await canvas(page).evaluate((element) => element.setAttribute('data-probe', 'first-viewer'));
}

async function expectSameViewer(page: Page) {
	await expect(page.locator('main canvas[data-probe="first-viewer"]')).toHaveCount(1);
	expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
}

// A few rendered frames first, so a marker still on its way out would have been caught drawing.
async function expectNoSummit(page: Page) {
	await framesPass(page, 6);
	expect(await readSummit(page)).toBeUndefined();
}

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

test.describe('@webgl summit marker visibility', () => {
	test('hides and restores the summit marker and pill without moving the camera, and keeps the map working', async ({
		page
	}) => {
		await page.setViewportSize(DESKTOP);
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await expectReadyStage(page);
		await probeViewer(page);
		await cameraAtRest(page);
		await expect.poll(() => pillDrawn(page)).toBe(true);
		await expect(hide(page)).toBeVisible();
		await expect(show(page)).toHaveCount(0);

		await test.step('hiding takes the disc and the pill away, camera and viewer untouched', async () => {
			const before = await cameraReading(page);
			expect(before).toBeDefined();

			await hide(page).click();

			await expect(show(page)).toBeVisible();
			await expect(hide(page)).toHaveCount(0);
			await expect.poll(() => summitDrawn(page)).toBe(false);
			await expectNoSummit(page);
			const after = await cameraReading(page);
			expect(after?.headingDegrees).toBeCloseTo(before!.headingDegrees, 6);
			expect(after?.pitchDegrees).toBeCloseTo(before!.pitchDegrees, 6);
			expect(after?.rangeMeters).toBeCloseTo(before!.rangeMeters, 3);
			await expectSameViewer(page);
			await expect(page.getByRole('heading', { level: 1 })).toHaveText(ACONCAGUA.name);
		});

		await test.step('the orbit turns the camera around the same summit while hidden', async () => {
			const start = await cameraReading(page);
			const orbit = stage(page).getByRole('button', { name: 'Start mountain orbit' });
			await expect(orbit).toBeEnabled({ timeout: 30_000 });

			await orbit.click();

			await expect(stage(page).getByRole('button', { name: 'Pause mountain orbit' })).toBeVisible();
			await expect
				.poll(async () =>
					Math.abs(((await cameraReading(page))?.headingDegrees ?? 0) - start!.headingDegrees)
				)
				.toBeGreaterThan(1);
			await expectNoSummit(page);
			await expect(show(page)).toBeVisible();

			await stage(page).getByRole('button', { name: 'Pause mountain orbit' }).click();
		});

		await test.step('zoom and reset keep the preference', async () => {
			await stage(page).getByRole('button', { name: 'Zoom in' }).click();
			await framesPass(page, 6);
			await expect(show(page)).toBeVisible();
			await expectNoSummit(page);

			const reset = page.getByRole('button', { name: 'Reset view' });
			await expect(reset).toBeEnabled();
			await reset.click();
			await cameraAtRest(page);
			await expect(show(page)).toBeVisible();
			await expectNoSummit(page);
		});

		await test.step('showing draws the same marker and pill again, with the camera where it was', async () => {
			const before = await cameraReading(page);

			await show(page).click();

			await expect(hide(page)).toBeVisible();
			await expect.poll(() => pillDrawn(page)).toBe(true);
			const after = await cameraReading(page);
			expect(after?.headingDegrees).toBeCloseTo(before!.headingDegrees, 6);
			expect(after?.rangeMeters).toBeCloseTo(before!.rangeMeters, 3);
			await expectSameViewer(page);
		});
	});

	test('draws the disc alone on the phone layout, hides it, and keeps the toolbar inside the stage', async ({
		page
	}) => {
		await page.setViewportSize({ width: 390, height: 844 });
		await page.goto(`/mountains/${ACONCAGUA.slug}`);
		await expectReadyStage(page);
		await probeViewer(page);
		await expect.poll(() => summitDrawn(page)).toBe(true);

		await hide(page).click();
		await expect(show(page)).toBeVisible();
		await expect.poll(() => summitDrawn(page)).toBe(false);
		await expectSameViewer(page);

		const { buttons, bounds } = await page.evaluate(() => {
			const root = document.querySelector('main [data-stage]')!;
			const rect = (element: Element) => {
				const { x, y, width, height } = element.getBoundingClientRect();
				return { x, y, width, height };
			};
			const toolbar = [...root.querySelectorAll('button')].filter((button) =>
				['Reset view', 'Show mountain markers', 'Enter fullscreen'].includes(
					button.textContent?.trim() ?? ''
				)
			);
			return {
				buttons: toolbar.map(rect),
				bounds: rect(root.querySelector('canvas')!)
			};
		});
		expect(buttons.length).toBeGreaterThanOrEqual(2);
		for (const [index, box] of buttons.entries()) {
			expect(box.width).toBeCloseTo(44, 0);
			expect(box.height).toBeCloseTo(44, 0);
			expect(box.x + box.width).toBeLessThanOrEqual(bounds.x + bounds.width + 0.5);
			expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 0.5);
			if (index > 0) {
				const above = buttons[index - 1]!;
				expect(box.y).toBeGreaterThanOrEqual(above.y + above.height - 0.5);
			}
		}

		await show(page).click();
		await expect(hide(page)).toBeVisible();
		await expect.poll(() => summitDrawn(page)).toBe(true);
		expect(await pillDrawn(page)).toBe(false);
	});

	test('keeps one preference from Today through the atlas, a mountain, Explore another and back', async ({
		page,
		request
	}) => {
		await page.setViewportSize(DESKTOP);
		await useScenario(request, 'catalog');
		await page.goto('/');
		await expectReadyStage(page);
		await probeViewer(page);
		await expect.poll(() => summitDrawn(page)).toBe(true);

		await test.step('hidden on Today', async () => {
			await hide(page).click();
			await expect(show(page)).toBeVisible();
			await expect.poll(() => summitDrawn(page)).toBe(false);
		});

		await test.step('still hidden on the atlas, which draws no markers', async () => {
			await primary(page).getByRole('link', { name: 'Atlas' }).click();
			await expect(page).toHaveURL(/\/atlas$/);
			await expectReadyStage(page);
			await expect(show(page)).toBeVisible();
			await expect.poll(async () => (await atlasLayer(page))?.shown).toBe(false);
		});

		await test.step('still hidden on a mountain opened from the atlas list', async () => {
			await list(page)
				.locator('summary')
				.filter({ hasText: /^Europe/ })
				.click();
			await list(page)
				.getByRole('link', { name: new RegExp(OLYMPUS.name) })
				.click();
			await expect(page).toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expectReadyStage(page);
			await expect(show(page)).toBeVisible();
			await expectNoSummit(page);
		});

		await test.step('still hidden after Explore another switches the mountain', async () => {
			await page.getByRole('button', { name: /^Explore another/ }).click();
			await expect(page).not.toHaveURL(new RegExp(`/mountains/${OLYMPUS.slug}$`));
			await expectReadyStage(page);
			await expect(show(page)).toBeVisible();
			await expectNoSummit(page);
		});

		await test.step('still hidden on Today again, and shown once the reader asks', async () => {
			await primary(page).getByRole('link', { name: 'Today' }).click();
			await expect(page).toHaveURL(/\/$/);
			await expectReadyStage(page);
			await expect(show(page)).toBeVisible();
			await expectNoSummit(page);

			await show(page).click();

			await expect(hide(page)).toBeVisible();
			await expect.poll(() => summitDrawn(page)).toBe(true);
			await expectSameViewer(page);
		});
	});
});
