import type { Page } from '@playwright/test';
import { resetStub, useScenario } from '../ssr/support';
import {
	DESKTOP,
	atlasLayer,
	cameraAtRest,
	expect,
	expectReadyStage,
	framesPass,
	globePosition,
	liveViewers,
	test
} from './support/stage';

const list = (page: Page) => page.getByRole('region', { name: 'Atlas mountains' });

async function chooseCountry(page: Page, name: string) {
	await list(page)
		.getByRole('button', { name: /^Country/ })
		.click();
	await page
		.locator('[popover]')
		.getByRole('option', { name: new RegExp(`^${name}\\s+\\d`) })
		.click();
}

// The `regions` scenario serves eight mountains; three of them are in Chile.
const TOTAL = 8;

const drawn = async (page: Page) =>
	((await atlasLayer(page))?.markers ?? []).map(({ slug }) => slug).sort();

test.beforeEach(async ({ page, request }) => {
	await page.setViewportSize(DESKTOP);
	await useScenario(request, 'regions');
});

test.afterEach(async ({ request }) => {
	await resetStub(request);
});

// Under reduced motion the globe never turns, so the camera at rest is the camera to compare.
test.describe('@webgl atlas filters on the globe', () => {
	test.use({ reducedMotion: 'reduce' });

	test('draws only the matches on the same viewer and camera, and every marker again once reset', async ({
		page
	}) => {
		await page.goto('/atlas');
		await expectReadyStage(page);
		await cameraAtRest(page);
		await page.waitForFunction(() => 'next' in window);
		await page.evaluate(() => {
			document.querySelector('main canvas')!.setAttribute('data-probe', 'first-viewer');
		});
		expect(await drawn(page)).toHaveLength(TOTAL);
		const camera = await globePosition(page);

		await list(page)
			.getByRole('button', { name: /^Filter(, \d+ active)?$/ })
			.click();
		await chooseCountry(page, 'Chile');

		await expect.poll(() => drawn(page)).toEqual(['almost-six', 'fitz-roy', 'six-thousand']);
		expect(await atlasLayer(page)).toMatchObject({ shown: true, layers: 1, entities: 3 });

		await test.step('a row the pointer rests on has its marker emphasized, until it is filtered out', async () => {
			await list(page)
				.getByRole('link', { name: /Fitz Roy/ })
				.hover();
			await expect.poll(async () => (await atlasLayer(page))?.highlighted).toBe('fitz-roy');

			await chooseCountry(page, 'Nepal');

			await expect.poll(() => drawn(page)).toEqual(['mount-everest']);
			expect((await atlasLayer(page))?.highlighted).toBeUndefined();
		});

		await test.step('a second filter narrows the globe further, and a reset brings every marker back', async () => {
			const elevation = list(page).getByRole('button', { name: /^Elevation/ });
			if ((await elevation.getAttribute('aria-expanded')) !== 'true') {
				await elevation.click();
			}
			await list(page)
				.getByRole('checkbox', { name: /^8,000–/ })
				.check();
			await page.keyboard.press('Escape');
			await expect.poll(() => drawn(page)).toEqual(['mount-everest']);
			expect(await atlasLayer(page)).toMatchObject({ shown: true, layers: 1, entities: 1 });

			await list(page).getByRole('button', { name: 'Reset filters and sort' }).click();
			await expect.poll(() => drawn(page)).toHaveLength(TOTAL);
		});

		await framesPass(page, 6);
		const after = await globePosition(page);
		expect(after?.longitude).toBeCloseTo(camera!.longitude, 6);
		expect(after?.latitude).toBeCloseTo(camera!.latitude, 6);
		expect(after?.distanceFromCenterMeters).toBeCloseTo(camera!.distanceFromCenterMeters, 0);
		await expect(page.locator('main canvas[data-probe="first-viewer"]')).toHaveCount(1);
		expect(await liveViewers(page)).toEqual({ canvases: 1, viewers: 1 });
	});
});
